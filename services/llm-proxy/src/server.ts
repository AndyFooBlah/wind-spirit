import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config, MODEL_CLASSES, type ModelClass } from './config.js';
import { HttpError } from './errors.js';
import { errorFields, log } from './log.js';
import { authenticate, initFirebase, principalLabel, type Principal } from './auth.js';
import { checkQuota, recordUsage } from './quota.js';
import { addUsage, estimateCost, MODELS, modelInfo, ZERO_USAGE, type Usage } from './models.js';
import { providerFor, type ProviderRequest } from './providers/index.js';
import { extractJson } from './providers/types.js';
import { validateAgainst } from './schema.js';
import { parseGenerateRequest, promptHash, resolveModel, type GenerateRequest } from './request.js';
import { DISABLED_NOTE, openrouterEnabled, openrouterPricingStatus, startOpenRouterPricingRefresh } from './providers/openrouter.js';

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
  provider?: string;
  principal?: string;
  cacheKey?: string;
  promptSha256?: string;
  inputTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  costSource?: string;
  cacheNote?: string;
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

/** Vertex/Anthropic errors wrap a JSON body inside the message; dig out the human-readable `error.message`. */
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

function toProviderRequest(gen: GenerateRequest, model: string): ProviderRequest {
  const req: ProviderRequest = { model, messages: gen.messages };
  if (gen.system !== undefined) req.system = gen.system;
  if (gen.schema !== undefined) req.schema = gen.schema;
  if (gen.maxOutputTokens !== undefined) req.maxOutputTokens = gen.maxOutputTokens;
  if (gen.temperature !== undefined) req.temperature = gen.temperature;
  if (gen.thinkingLevel !== undefined) req.thinkingLevel = gen.thinkingLevel;
  if (gen.cache !== undefined) req.cache = gen.cache;
  return req;
}

function usageBody(u: Usage): Record<string, number> {
  return { input: u.input, output: u.output, thoughts: u.thoughts, cached: u.cached, cacheWrite: u.cacheWrite };
}

// ---------- routes ----------

function modelsBody(): Record<string, unknown> {
  const pricing: Record<string, unknown> = {};
  const orEnabled = openrouterEnabled();
  for (const m of Object.values(MODELS)) {
    const available = m.provider !== 'openrouter' || orEnabled;
    const note = m.provider === 'openrouter' && !orEnabled ? DISABLED_NOTE : m.note;
    pricing[m.id] = {
      provider: m.provider,
      location: m.location ?? locationFor(m.provider),
      available,
      input: m.pricing.input,
      output: m.pricing.output,
      cacheRead: m.pricing.cacheRead,
      cacheWrite: m.pricing.cacheWrite,
      nativeJsonSchema: m.nativeJsonSchema,
      minCacheTokens: m.minCacheTokens,
      ...(m.supportedParameters ? { supportedParameters: m.supportedParameters } : {}),
      ...(note ? { note } : {}),
    };
  }
  return {
    classes: { ...config.models },
    evalModels: [...config.evalModels],
    pricingUnit: 'USD per 1M tokens',
    openrouter: { enabled: orEnabled, nativeJson: config.openrouter.nativeJson, pricing: openrouterPricingStatus() },
    pricing,
  };
}

function locationFor(provider: string): string {
  switch (provider) {
    case 'gemini': return config.location;
    case 'anthropic': return config.anthropicLocation;
    case 'openrouter': return 'openrouter.ai';
    default: return config.maasLocation;
  }
}

async function health(url: URL, res: ServerResponse): Promise<void> {
  const models = { ...config.models };
  const openrouter = openrouterEnabled() ? 'enabled' : 'disabled';
  if (url.searchParams.get('deep') !== '1') {
    sendJson(res, 200, { ok: true, models, requireAuth: config.requireAuth, location: config.location, openrouter });
    return;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  const probe = async (cls: ModelClass) => {
    const t0 = Date.now();
    const model = config.models[cls];
    try {
      const r = await providerFor(model).generate(
        { model, messages: [{ role: 'user', text: 'Reply with the single word OK.' }], maxOutputTokens: 256, thinkingLevel: 'low' },
        ac.signal,
      );
      return { ok: true, model, ms: Date.now() - t0, text: r.text.slice(0, 40), usage: usageBody(r.usage), cost: estimateCost(model, r.usage) };
    } catch (err) {
      return { ok: false, model, ms: Date.now() - t0, ...errorFields(err) };
    }
  };
  try {
    const results = await Promise.all(MODEL_CLASSES.map(probe));
    const deep = Object.fromEntries(MODEL_CLASSES.map((c, i) => [c, results[i]]));
    const ok = results.every((r) => r.ok);
    if (!ok) log('ERROR', 'deep health check failed', deep);
    sendJson(res, ok ? 200 : 503, { ok, models, requireAuth: config.requireAuth, location: config.location, openrouter, deep });
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

/** Shared prelude for /v1/generate and /v1/stream: auth, parse, resolve model, quota. */
async function prelude(ctx: Ctx): Promise<{ principal: Principal; gen: GenerateRequest; preq: ProviderRequest }> {
  const principal = await authenticate(ctx.req);
  ctx.entry.principal = principalLabel(principal);
  const gen = parseGenerateRequest(await readJson(ctx.req));
  const model = resolveModel(gen);
  if (gen.class) ctx.entry.class = gen.class;
  ctx.entry.model = model;
  const provider = providerFor(model);
  ctx.entry.provider = provider.name;
  if (provider.available && !provider.available()) {
    throw new HttpError(503, 'provider_disabled', `${provider.name} is not configured on this deployment (${DISABLED_NOTE})`, { provider: provider.name, model });
  }
  ctx.entry.promptSha256 = promptHash(gen);
  if (gen.cacheKey) ctx.entry.cacheKey = gen.cacheKey;
  else if (gen.cache) ctx.entry.cacheKey = gen.cache.key;
  if (!modelInfo(model)) log('WARNING', 'model not in pricing catalog; cost will be 0', { model });
  await checkQuota(principal);
  return { principal, gen, preq: toProviderRequest(gen, model) };
}

/** Cost as the provider reported it (OpenRouter credits) or, failing that, from the pricing table. */
interface CostInfo {
  cost: number;
  costSource: string;
}

function noteUsage(entry: RequestLog, usage: Usage, model: string, cacheNote?: string, reported?: { cost: number; source: string }): CostInfo {
  entry.inputTokens = usage.input;
  entry.outputTokens = usage.output;
  entry.thoughtTokens = usage.thoughts;
  entry.cachedTokens = usage.cached;
  entry.cacheWriteTokens = usage.cacheWrite;
  const info: CostInfo = reported ? { cost: reported.cost, costSource: reported.source } : { cost: estimateCost(model, usage), costSource: 'table' };
  entry.costUsd = info.cost;
  entry.costSource = info.costSource;
  if (cacheNote) entry.cacheNote = cacheNote;
  return info;
}

async function v1Generate(ctx: Ctx): Promise<void> {
  const { principal, gen, preq } = await prelude(ctx);
  const provider = providerFor(preq.model);
  const { signal, done, timedOut } = requestSignal(ctx.res);
  try {
    let total: Usage = ZERO_USAGE;
    // Provider-reported cost is summed across the retry; if any attempt lacks it, fall back to the table for the whole call.
    let reported: { cost: number; source: string } | undefined = { cost: 0, source: '' };
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try {
        r = await provider.generate(preq, signal);
      } catch (err) {
        throw upstreamError(err, timedOut());
      }
      total = addUsage(total, r.usage);
      reported = reported && r.cost !== undefined && r.costSource ? { cost: reported.cost + r.cost, source: r.costSource } : undefined;
      let json: unknown;
      if (gen.schema) {
        json = extractJson(r.text);
        const problem = json === undefined ? 'not JSON' : validateAgainst(gen.schema, json);
        if (problem) {
          if (attempt === 0) {
            ctx.entry.retried = true;
            log('WARNING', 'structured output invalid; retrying once', { model: preq.model, problem, promptSha256: ctx.entry.promptSha256 });
            continue;
          }
          noteUsage(ctx.entry, total, preq.model, r.cacheNote, reported);
          throw new HttpError(502, 'bad_model_output', `model output did not match schema twice (${problem})`, { finishReason: r.finishReason });
        }
      }
      const { cost, costSource } = noteUsage(ctx.entry, total, preq.model, r.cacheNote, reported);
      sendJson(ctx.res, 200, {
        text: r.text,
        ...(gen.schema ? { json } : {}),
        usage: usageBody(total),
        cost,
        costSource,
        model: preq.model,
        provider: provider.name,
        ms: Date.now() - ctx.startedAt,
        finishReason: r.finishReason,
        ...(r.cacheNote ? { cacheNote: r.cacheNote } : {}),
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
  const { principal, preq } = await prelude(ctx);
  const provider = providerFor(preq.model);
  const { signal, done, timedOut } = requestSignal(ctx.res);
  const res = ctx.res;
  const send = (obj: unknown) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  let usage: Usage = ZERO_USAGE;
  try {
    const stream = provider.stream(preq, signal);
    // Pull the first event before committing to a 200 so upstream rejections still map to proper status codes.
    let first;
    try {
      first = await stream.next();
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
    let cacheNote: string | undefined;
    let finishReason: string | undefined;
    let reported: { cost: number; source: string } | undefined;
    try {
      let cur = first;
      while (!cur.done) {
        const ev = cur.value;
        if ('done' in ev) {
          usage = ev.usage;
          cacheNote = ev.cacheNote;
          finishReason = ev.finishReason;
          reported = ev.cost !== undefined && ev.costSource ? { cost: ev.cost, source: ev.costSource } : undefined;
        } else if (ev.text) {
          send({ text: ev.text });
        }
        cur = await stream.next();
      }
    } catch (err) {
      const e = upstreamError(err, timedOut());
      log('WARNING', 'stream interrupted', { ...errorFields(err), code: e.code });
      send({ error: e.code, message: e.message });
      res.end();
      return;
    }
    const { cost, costSource } = noteUsage(ctx.entry, usage, preq.model, cacheNote, reported);
    send({ done: true, usage: usageBody(usage), cost, costSource, model: preq.model, provider: provider.name, ms: Date.now() - ctx.startedAt, finishReason });
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
      await health(url, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      await authenticate(req);
      sendJson(res, 200, modelsBody());
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
// Public endpoint, no key needed: live OpenRouter prices overwrite the static table at startup and hourly.
startOpenRouterPricingRefresh();
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
    anthropicLocation: config.anthropicLocation,
    maasLocation: config.maasLocation,
    models: config.models,
    evalModels: config.evalModels,
    requireAuth: config.requireAuth,
    dailyTokenQuota: config.dailyTokenQuota,
    requestTimeoutMs: config.requestTimeoutMs,
    openrouter: openrouterEnabled() ? 'enabled' : 'disabled', // never the key itself
    openrouterNativeJson: config.openrouter.nativeJson,
  });
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    log('INFO', `${sig} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
