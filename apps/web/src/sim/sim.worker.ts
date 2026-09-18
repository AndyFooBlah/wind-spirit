/// <reference lib="webworker" />
/** The sim worker: owns SimHost, runs the timer, calls the model proxy with a token minted on the main thread. */
import { HttpLlmClient, JevJudge, ProxySystemOne } from '@wind-spirit/agents';
import { PROXY_URL } from '../firebase-config.ts';
import { SimHost } from './host.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

let tokenSeq = 0;
const tokenWaiters = new Map<number, (t: string | undefined) => void>();
const tokenFn = (): Promise<string | undefined> => new Promise(resolve => {
  const id = ++tokenSeq; tokenWaiters.set(id, resolve); post({ type: 'needToken', id });
  setTimeout(() => { if (tokenWaiters.delete(id)) resolve(undefined); }, 15_000);
});

// HttpLlmClient defaults its fetchImpl to the bare `fetch` and calls it as a method, which throws "Illegal invocation"
// in a WorkerGlobalScope; pass a wrapper that calls the global fetch with the right receiver.
const client = new HttpLlmClient(PROXY_URL, tokenFn, (input, init) => fetch(input, init));
// The judge goes through the same proxy, which holds the TypeSafe key; nothing here carries one.
const judge = new JevJudge({ transport: new ProxySystemOne(PROXY_URL, tokenFn, (input, init) => fetch(input, init)) });
const host = new SimHost({ post, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h as number), client, judge });

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'init': host.init(m.seed, m.opts); break;
      case 'load': host.load(m.snapshot, m.inputsAfter); break;
      case 'queue': host.queue(m.input); break;
      case 'speed': host.setSpeed(m.speed); break;
      case 'step': host.step(); break;
      case 'snapshot': host.postSnapshot(m.reason ?? 'request'); break;
      case 'requestVillage': { const d = host.villageDetail(m.id); if (d) post({ type: 'village', detail: d }); break; }
      case 'settings': host.setSettings(m.settings); break;
      case 'token': { const r = tokenWaiters.get(m.id); if (r) { tokenWaiters.delete(m.id); r(m.token); } break; }
      case 'dreamStart': host.dreamStart(m.village); break;
      case 'dreamSend': void host.dreamSend(m.text); break;
      case 'sun': void host.sun(m.id, m.question, m.before); break;
      case 'dreamClose': void host.dreamClose(); break;
      case 'narrate': host.narrate(m.request).then(text => post({ type: 'narrative', id: m.request.id, text }), e => post({ type: 'narrative', id: m.request.id, error: (e as Error)?.message ?? String(e) })); break;
    }
  } catch (e) { post({ type: 'error', message: (e as Error)?.message ?? String(e) }); }
};

post({ type: 'ready' });
