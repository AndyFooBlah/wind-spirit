import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config, type ModelClass } from './config.js';
import { HttpError } from './errors.js';
import { errorFields, log } from './log.js';
import { authenticate, initFirebase, principalLabel, type Principal } from './auth.js';
import { checkQuota, recordUsage } from './quota.js';
import { generate, generateStream, modelFor, usageOf, type Usage } from './gemini.js';
import { parseGenerateRequest, promptHash, type GenerateRequest } from './request.js';

// ---------- helpers ----------

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > config.maxBodyBytes) throw new HttpError(413, 'too_large', `body exceeds ${config.maxBodyBytes} bytes`);
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) throw new HttpError(400, 'bad_request', 'empty body');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'bad_request', 'body is not valid JSON');
  }
}

/** Abort signal that fires on request timeout or client disconnect. */
function requestSignal(res: ServerResponse): { signal: AbortSignal; done: () => void; timedOut: () => boolean } {
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort(new Error('request timeout'));
  }, config.requestTimeoutMs);
  res.on('close', () => {
    if (!res.writableFinished) ac.abort(new Error('client disconnected'));
  });
  return { signal: ac.signal, done: () => clearTimeout(timer), timedOut: () => timedOut };
}

interface RequestLog {
  route: string;
  class?: ModelClass;
  model?: string;
  principal?: string;
  cacheKey?: string;
  promptSha256?: string;
  inputTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  retried?: boolean;
}

function finishLog(entry: RequestLog, status: number, startedAt: number, extra: Record<string, unknown> = {}): void {
  const severity = status >= 500 ? 'ERROR' : status >= 400 ? 'WARNING' : 'INFO';
  log(severity, 'request', { ...entry, status, ms: Date.now() - startedAt, ...extra });
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /abort|timeout/i.test(err.message));
}

function upstreamError(err: unknown, timedOut: boolean): HttpError {
  if (timedOut) return new HttpError(504, 'timeout', `model call exceeded ${config.requestTimeoutMs} ms`);
  if (isAbort(err)) return new HttpError(499, 'client_closed', 'client disconnected');
  // Surface upstream 4xx (bad schema, unknown model) as 502 with the message; the client asked for something the model rejected.
  return new HttpError(502, 'upstream', upstreamMessage(err).slice(0, 2000), { upstreamStatus: upstreamStatus(err) });
}

/** The Vertex ApiError wraps a JSON body inside its message; dig out the human-readable `error.message`. */
function upstreamMessage(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (let i = 0; i < 3; i++) {
    try {
      const parsed = JSON.parse(msg) as { error?: { message?: unknown } };
      const inner = parsed?.error?.message;
      if (typeof inner !== 'string') break;
      msg = inner;
    } catch {
      break;
    }
  }
  return msg.trim();
}

function upstreamStatus(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === 'number' ? s : undefined;
}

// ---------- routes ----------

async function healthz(url: URL, res: ServerResponse): Promise<void> {
  const models = { ...config.models };
  if (url.searchParams.get('deep') !== '1') {
    sendJson(res, 200, { ok: true, models, requireAuth: config.requireAuth, location: config.location });
    return;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  const probe = async (cls: ModelClass) => {
    const t0 = Date.now();
    try {
      const r = await generate(
        { class: cls, messages: [{ role: 'user', text: 'Reply with the single word OK.' }], maxOutputTokens: 256, thinkingLevel: 'low' },
        ac.signal,
      );
      return { ok: true, model: modelFor(cls), ms: Date.now() - t0, text: (r.text ?? '').slice(0, 40), usage: usageOf(r) };
    } catch (err) {
      return { ok: false, model: modelFor(cls), ms: Date.now() - t0, ...errorFields(err) };
    }
  };
  try {
    const [routine, capable] = await Promise.all([probe('routine'), probe('capable')]);
    const ok = routine.ok && capable.ok;
    if (!ok) log('ERROR', 'deep health check failed', { routine, capable });
    sendJson(res, ok ? 200 : 503, { ok, models, requireAuth: config.requireAuth, location: config.location, deep: { routine, capable } });
  } finally {
    clearTimeout(timer);
  }
}

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  entry: RequestLog;
  startedAt: number;
}

/** Shared prelude for /v1/*: auth, parse, quota. */
async function prelude(ctx: Ctx): Promise<{ principal: Principal; gen: GenerateRequest }> {
  const principal = await authenticate(ctx.req);
  ctx.entry.principal = principalLabel(principal);
  const gen = parseGenerateRequest(await readJson(ctx.req));
  ctx.entry.class = gen.class;
  ctx.entry.model = modelFor(gen.class);
  ctx.entry.promptSha256 = promptHash(gen);
  if (gen.cacheKey) ctx.entry.cacheKey = gen.cacheKey;
  await checkQuota(principal);
  return { principal, gen };
}

function noteUsage(entry: RequestLog, usage: Usage): void {
  entry.inputTokens = usage.input;
  entry.outputTokens = usage.output;
  entry.thoughtTokens = usage.thoughts;
}

async function v1Generate(ctx: Ctx): Promise<void> {
  const { principal, gen } = await prelude(ctx);
  const { signal, done, timedOut } = requestSignal(ctx.res);
  try {
    let total: Usage = { input: 0, output: 0, thoughts: 0 };
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try {
        r = await generate(gen, signal);
      } catch (err) {
        throw upstreamError(err, timedOut());
      }
      const usage = usageOf(r);
      total = { input: total.input + usage.input, output: total.output + usage.output, thoughts: total.thoughts + usage.thoughts };
      const text = r.text ?? '';
      let json: unknown;
      if (gen.schema) {
        try {
          json = JSON.parse(text);
        } catch {
          if (attempt === 0) {
            ctx.entry.retried = true;
            log('WARNING', 'structured output did not parse; retrying once', { model: ctx.entry.model, promptSha256: ctx.entry.promptSha256 });
            continue;
          }
          noteUsage(ctx.entry, total);
          throw new HttpError(502, 'bad_model_output', 'model returned non-JSON output twice', { finishReason: r.candidates?.[0]?.finishReason });
        }
      }
      noteUsage(ctx.entry, total);
      sendJson(ctx.res, 200, {
        text,
        ...(gen.schema ? { json } : {}),
        usage: { input: total.input, output: total.output, thoughts: total.thoughts },
        model: ctx.entry.model,
        ms: Date.now() - ctx.startedAt,
        finishReason: r.candidates?.[0]?.finishReason,
      });
      return;
    }
  } finally {
    done();
    const used = (ctx.entry.inputTokens ?? 0) + (ctx.entry.outputTokens ?? 0);
    if (used > 0) void recordUsage(principal, used);
  }
}

async function v1Stream(ctx: Ctx): Promise<void> {
  const { principal, gen } = await prelude(ctx);
  const { signal, done, timedOut } = requestSignal(ctx.res);
  const res = ctx.res;
  const send = (obj: unknown) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  let usage: Usage = { input: 0, output: 0, thoughts: 0 };
  try {
    let stream;
    try {
      stream = await generateStream(gen, signal);
    } catch (err) {
      throw upstreamError(err, timedOut());
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    try {
      for await (const chunk of stream) {
        if (chunk.usageMetadata) usage = usageOf(chunk);
        const text = chunk.text;
        if (text) send({ text });
      }
    } catch (err) {
      const e = upstreamError(err, timedOut());
      log('WARNING', 'stream interrupted', { ...errorFields(err), code: e.code });
      send({ error: e.code, message: e.message });
      res.end();
      return;
    }
    noteUsage(ctx.entry, usage);
    send({ done: true, usage: { input: usage.input, output: usage.output, thoughts: usage.thoughts }, model: ctx.entry.model, ms: Date.now() - ctx.startedAt });
    res.end();
  } finally {
    done();
    const used = usage.input + usage.output;
    if (used > 0) void recordUsage(principal, used);
  }
}

// ---------- server ----------

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const startedAt = Date.now();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const entry: RequestLog = { route: `${req.method} ${url.pathname}` };
  cors(res);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    // Cloud Run's Google Frontend reserves exactly `/healthz` and answers its own 404 before the container
    // sees it, so the canonical route is `/health`; `/healthz` stays as an alias for local development.
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
      await healthz(url, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/generate') {
      await v1Generate({ req, res, entry, startedAt });
      finishLog(entry, res.statusCode, startedAt);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/stream') {
      await v1Stream({ req, res, entry, startedAt });
      finishLog(entry, res.statusCode, startedAt);
      return;
    }
    throw new HttpError(404, 'not_found', `no route for ${entry.route}`);
  } catch (err) {
    const httpErr = err instanceof HttpError ? err : new HttpError(500, 'internal', 'internal error');
    if (!(err instanceof HttpError)) log('ERROR', 'unhandled error', { ...entry, ...errorFields(err) });
    finishLog(entry, httpErr.status, startedAt, { code: httpErr.code, ...(httpErr.status >= 500 ? { detail: httpErr.message } : {}) });
    sendJson(res, httpErr.status, httpErr.body());
    if (!res.writableEnded) res.end();
  }
}

initFirebase();
const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    log('ERROR', 'handler crashed', errorFields(err));
    if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
    else res.end();
  });
});
// Allow long model calls: Node's defaults would cut the response before our own 120 s timeout.
server.requestTimeout = config.requestTimeoutMs + 30_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 620_000; // longer than Cloud Run's idle timeout so Cloud Run closes first

server.listen(config.port, () => {
  log('INFO', 'llm-proxy listening', {
    port: config.port,
    project: config.project,
    location: config.location,
    models: config.models,
    requireAuth: config.requireAuth,
    dailyTokenQuota: config.dailyTokenQuota,
    requestTimeoutMs: config.requestTimeoutMs,
  });
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    log('INFO', `${sig} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
