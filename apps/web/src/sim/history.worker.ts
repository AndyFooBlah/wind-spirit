/// <reference lib="webworker" />
/** The history worker: a second sim instance that replays to a requested tick and renders read-only views. The live sim is untouched. */
import { worldAt } from './history.ts';
import { buildFrame, buildVillageDetail } from './views.ts';
import type { FromHistory, ToHistory } from './protocol.ts';

const post = (m: FromHistory) => (self as unknown as Worker).postMessage(m);

self.onmessage = (ev: MessageEvent<ToHistory>) => {
  const m = ev.data; if (m.type !== 'seek') return;
  try {
    const w = worldAt({ snapshot: m.snapshot, snapshotTick: m.snapshotTick, inputs: m.inputs }, m.targetTick);
    const detail = m.village !== undefined ? buildVillageDetail(w, m.village, m.villageEvents.filter(e => e.t < m.targetTick)) : undefined;
    post({ type: 'frame', seq: m.seq, tick: w.tick, frame: buildFrame(w), detail });
  } catch (e) { post({ type: 'error', seq: m.seq, message: (e as Error)?.message ?? String(e) }); }
};
