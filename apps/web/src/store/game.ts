/**
 * UI state (zustand) and the game controller: owns the worker, the database, auth tokens for the worker, autosave.
 * Components read the store; they call the exported actions to change the world.
 */
import { create } from 'zustand';
import type { BreathAction, Event, Input } from '@wind-spirit/sim';
import { P } from '@wind-spirit/sim';
import { WEEKS_PER_YEAR, seasonOf } from '@wind-spirit/sim';
import { idToken } from '../auth.ts';
import { forgetInvite } from '../invite.ts';
import { audio, dominantTerrain, type AudioSettings } from '../audio/audio.ts';
import { historyWorthy } from '../sim/views.ts';
import { DEFAULT_SETTINGS, type Frame, type FromHistory, type FromWorker, type JournalEntry, type Settings, type Speed, type StaticMap, type ToHistory, type ToWorker, type VillageDetail, type SeriesPoint } from '../sim/protocol.ts';
import { createWorld, deleteWorld, listWorlds, loadEvents, loadHistoryWindow, loadJournals, loadResume, newWorldId, openStore, Persister, setStoreBlockedHandler, type Db, type WorldMeta, saveSeries, loadSeries, loadSnapshotText, snapshotTicks, saveSun, loadSun } from './db.ts';

export type Zoom = 'world' | 'region' | 'local' | 'village';
export interface Toast { id: number; text: string; kind: 'attention' | 'info' | 'error'; village?: number; event?: string; }
export interface DreamTurn { role: 'spirit' | 'chief'; text: string; }
export interface DreamState { village: number; turns: DreamTurn[]; streaming: string; busy: boolean; closing: boolean; }
/** History mode: a replayed past state rendered read-only while the live sim stays paused. */
export interface HistoryState { target: number; tick: number; frame: Frame; detail?: VillageDetail; loading: boolean; }
export type NarrativeSpan = 'y10' | 'y50' | 'all';
export type NarrativeStyle = 'chronicle' | 'saga' | 'plain';
export interface NarrativeState { loading: boolean; text?: string; error?: string; fromTick: number; toTick: number; }

export interface GameState {
  screen: 'gallery' | 'game';
  worlds: WorldMeta[];
  world?: WorldMeta;
  map?: StaticMap;
  frame?: Frame;
  speed: Speed;
  resumeSpeed: Speed;
  selected?: number;
  detail?: VillageDetail;
  journals: JournalEntry[];
  toasts: Toast[];
  settings: Settings;
  talkedTo: number[];
  dream?: DreamState;
  pendingClaims: { village: number; texts: string[] }[];
  zoom: Zoom;
  center: { x: number; y: number };
  targeting: boolean;          // storm: next map click picks the tile
  loading: string;
  proxyOk?: boolean;
  lastEvents: Event[];
  whisperFor?: number;
  waiting: number[];
  history?: HistoryState;
  /** yearly readings for the overview charts, oldest first */
  series: SeriesPoint[];
  overview: boolean;
  techOpen: boolean;
  /** the proxy refused a model call for want of an invitation: show the gate again */
  inviteLost: boolean;
  /** the sun spirit: past questions and answers this world, and the one in flight */
  sun: { open: boolean; turns: { question: string; answer: string; tick: number }[]; asking?: { id: number; question: string; streaming: string } };
  /** snapshots still to read for the charts, when an older save predates the series */
  seriesBackfill?: { done: number; total: number };
  narratives: Record<string, NarrativeState>;
  audioSettings: AudioSettings;
}

export const useGame = create<GameState>(() => ({
  screen: 'gallery', worlds: [], speed: 'pause', resumeSpeed: 'normal', journals: [], toasts: [], settings: loadSettings(), talkedTo: [], series: [], overview: false, techOpen: false, inviteLost: false, sun: { open: false, turns: [] },
  pendingClaims: [], zoom: 'local', center: { x: 32, y: 32 }, targeting: false, loading: '', lastEvents: [], waiting: [], narratives: {}, audioSettings: audio.settings,
}));

const set = useGame.setState; const get = useGame.getState;

// ---------- infrastructure ----------

let db: Db | undefined; let worker: Worker | undefined; let persister: Persister | undefined; let toastSeq = 0;
let villageTimer: number | undefined; let lastVillageRequest = 0;
let historyWorker: Worker | undefined; let seekSeq = 0; let seekTimer: number | undefined;
let narrativeSeq = 0; const narrativeWaiters = new Map<number, string>();
let knownParties = new Set<number>();

async function ensureDb(): Promise<Db> {
  if (db) return db;
  setStoreBlockedHandler(() => { toast('Another Wind Spirit tab holds an older save format open. Close it (or reload it) and this one will continue.', 'error'); set({ loading: 'Waiting for another tab to close…' }); });
  db = await openStore(); set(s => (s.loading.startsWith('Waiting') ? { loading: '' } : {}));
  return db;
}

function send(m: ToWorker): void { worker?.postMessage(m); }

function loadSettings(): Settings {
  try { const raw = localStorage.getItem('ws.settings'); if (raw) { const s = JSON.parse(raw) as Partial<Settings>; return { ...DEFAULT_SETTINGS, ...s, autoPause: { ...DEFAULT_SETTINGS.autoPause, ...(s.autoPause ?? {}) }, focused: [] }; } } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}

function startWorker(): Promise<void> {
  worker?.terminate();
  worker = new Worker(new URL('../sim/sim.worker.ts', import.meta.url), { type: 'module' });
  return new Promise(resolve => {
    worker!.onmessage = (ev: MessageEvent<FromWorker>) => { if (ev.data.type === 'ready') resolve(); onWorker(ev.data); };
    worker!.onerror = e => toast(`Worker error: ${e.message}`, 'error');
  });
}

function onWorker(m: FromWorker): void {
  switch (m.type) {
    case 'map': set({ map: m.map }); break;
    case 'loaded': { set({ frame: m.frame, loading: '' }); const v = m.frame.villages.find(x => x.alive); if (v && get().selected === undefined) { const [x, y] = tileXY(v.tile); set({ center: { x: x + 0.5, y: y + 0.5 } }); } knownParties = new Set(m.frame.parties.map(p => p.id)); refreshScene(); break; }
    case 'tick': {
      set({ frame: m.frame, lastEvents: m.events });
      void persister?.tick(m.tick, m.inputs, m.events.filter(historyWorthy));
      soundTick(m.frame, m.events);
      const w = get().world; if (w) set({ world: { ...w, lastTick: m.tick + 1 } });
      for (const e of m.events) if (e.type === 'SpiritBreathed') toast(breathText(e.action, e.cost), 'info');
      const landed = new Set(m.events.filter(e => e.type === 'ClaimRecorded').map(e => (e as { village: number }).village));
      if (landed.size) set(s => ({ pendingClaims: s.pendingClaims.filter(c => !landed.has(c.village)) }));
      if (get().selected !== undefined) requestVillage(get().selected!, false);
      break;
    }
    case 'snapshot': void persister?.snapshot(m.tick, m.json, m.reason); break;
    // Pause and say what happened; do not move the camera (clicking the toast goes there). Jumping on every founding and prayer was distracting.
    case 'attention': { const text = eventText(m.event); const village = villageOf(m.event); toast(text, 'attention', village, m.event.type); break; }
    case 'journal': set(s => ({ journals: [...s.journals, m.entry] })); void persister?.journal(m.entry); break;
    case 'village': if (m.detail.id === get().selected) set({ detail: m.detail }); break;
    case 'speed': set(s => ({ speed: m.speed, toasts: m.speed === 'pause' ? s.toasts : s.toasts.filter(t => t.kind !== 'attention') })); refreshScene(); break;
    case 'waiting': set({ waiting: m.villages }); break;
    case 'needToken': void idToken().then(token => { send({ type: 'token', id: m.id, token }); set({ proxyOk: !!token }); }); break;
    case 'dreamChunk': set(s => s.dream ? { dream: { ...s.dream, streaming: s.dream.streaming + m.text } } : {}); break;
    case 'dreamReply': set(s => s.dream ? { dream: { ...s.dream, streaming: '', busy: false, turns: m.text ? [...s.dream.turns, { role: 'chief', text: m.text }] : s.dream.turns } } : {}); break;
    case 'narrative': { const key = narrativeWaiters.get(m.id); narrativeWaiters.delete(m.id); if (key) set(s => ({ narratives: { ...s.narratives, [key]: { ...s.narratives[key], loading: false, text: m.text, error: m.error } } })); break; }
    case 'dreamClosed': {
      audio.spirit('dream-close', 1);
      const d = get().dream; set({ dream: undefined });
      if (d) { if (m.claims.length) { set(s => ({ pendingClaims: [...s.pendingClaims, { village: d.village, texts: m.claims.map(c => c.text) }] })); toast(`${m.claims.length} claim${m.claims.length === 1 ? '' : 's'} will enter the chronicle when the week turns.`, 'info', d.village); } else toast('The dream ended; the chief noted nothing to hold you to.', 'info', d.village); }
      break;
    }
    case 'sunChunk': set(s => s.sun.asking?.id === m.id ? { sun: { ...s.sun, asking: { ...s.sun.asking, streaming: s.sun.asking.streaming + m.text } } } : {}); break;
    case 'sunReply': {
      const s = get(); const a = s.sun.asking; if (!a || a.id !== m.id) break;
      if (m.error || !m.text) { toast(`The sun spirit did not answer: ${m.error ?? 'nothing came back'}`, 'error'); set({ sun: { ...s.sun, asking: undefined } }); break; }
      const turn = { question: a.question, answer: m.text, tick: s.frame?.tick ?? 0 };
      set({ sun: { ...s.sun, asking: undefined, turns: [...s.sun.turns, turn] } });
      const w = s.world; if (w) void ensureDb().then(d => saveSun(d, w.id, turn.tick, turn.question, turn.answer));
      break;
    }
    case 'series': { set(s => ({ series: [...s.series.filter(p => p.tick !== m.point.tick), m.point].sort((a, b) => a.tick - b.tick) })); const w = get().world; if (w) void ensureDb().then(d => saveSeries(d, w.id, m.point)); break; }
    case 'error':
      if (/proxy 403/.test(m.message) && /not_invited/.test(m.message)) { forgetInvite(); if (!get().inviteLost) { set({ inviteLost: true }); if (get().speed !== 'pause') setSpeed('pause'); } break; }
      toast(m.message, 'error', m.village); break;
  }
}
export function inviteRestored(): void { set({ inviteLost: false }); }

function tileXY(tile: number): [number, number] { const w = get().map?.width ?? 64; return [tile % w, Math.floor(tile / w)]; }

export function toast(text: string, kind: Toast['kind'] = 'info', village?: number, event?: string): void {
  const id = ++toastSeq; set(s => ({ toasts: [...s.toasts.slice(-5), { id, text, kind, village, event }] }));
  // attention toasts stay until the game resumes (see the 'speed' message); the rest fade
  if (kind !== 'attention') window.setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 6000);
}
export function dismissToast(id: number): void { set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })); }

// ---------- gallery ----------

export async function refreshWorlds(): Promise<void> { const d = await ensureDb(); set({ worlds: await listWorlds(d) }); }

export type WorldSize = 'small' | 'medium' | 'large';
export const WORLD_SIZES: Record<WorldSize, { width: number; height: number; villages: number; label: string }> = {
  small: { width: 64, height: 64, villages: 4, label: '64 × 64 tiles, four villages; fills in about 150 years' },
  medium: { width: 96, height: 96, villages: 6, label: '96 × 96 tiles, six villages' },
  large: { width: 128, height: 128, villages: 8, label: '128 × 128 tiles, eight villages; room for centuries' },
};

export async function newWorld(seed: string, name?: string, size: WorldSize = 'large'): Promise<void> {
  const d = await ensureDb(); const s = seed.trim() || Math.random().toString(36).slice(2, 10); const dims = WORLD_SIZES[size];
  const meta = await createWorld(d, { id: newWorldId(), name: name?.trim() || s, seed: s, options: { width: dims.width, height: dims.height, villages: dims.villages, startPop: 20 } });
  set({ loading: 'Shaping the world…', screen: 'game', world: meta, frame: undefined, map: undefined, selected: undefined, detail: undefined, journals: [], talkedTo: [], pendingClaims: [], speed: 'pause', zoom: 'local', history: undefined, narratives: {}, series: [], overview: false, sun: { open: false, turns: [] } });
  await startWorker(); persister = new Persister(d, meta.id); audio.setWorld(s);
  pushSettings();
  send({ type: 'init', seed: s, opts: meta.options });
  send({ type: 'snapshot', reason: 'start' });
  await refreshWorlds();
}

export async function continueWorld(id: string): Promise<void> {
  const d = await ensureDb(); const meta = (await listWorlds(d)).find(w => w.id === id); if (!meta) return;
  const resume = await loadResume(d, id);
  set({ loading: 'Remembering…', screen: 'game', world: meta, frame: undefined, map: undefined, selected: undefined, detail: undefined, journals: await loadJournals(d, id), talkedTo: [], pendingClaims: [], speed: 'pause', zoom: 'local', history: undefined, narratives: {}, series: await loadSeries(d, id), overview: false, sun: { open: false, turns: (await loadSun(d, id)).map(r => ({ question: r.question, answer: r.answer, tick: r.tick })) } });
  await startWorker(); persister = new Persister(d, meta.id); audio.setWorld(meta.seed);
  pushSettings();
  if (resume) send({ type: 'load', snapshot: resume.snapshot, inputsAfter: resume.inputsAfter });
  else { send({ type: 'init', seed: meta.seed, opts: meta.options }); send({ type: 'snapshot', reason: 'start' }); }
}

export async function removeWorld(id: string): Promise<void> { const d = await ensureDb(); await deleteWorld(d, id); await refreshWorlds(); }

export async function leaveWorld(): Promise<void> {
  send({ type: 'speed', speed: 'pause' });
  await new Promise(r => setTimeout(r, 150)); await persister?.flush();
  worker?.terminate(); worker = undefined; persister = undefined;
  historyWorker?.terminate(); historyWorker = undefined; audio.village(null);
  set({ screen: 'gallery', world: undefined, frame: undefined, map: undefined, selected: undefined, detail: undefined, dream: undefined, speed: 'pause', history: undefined });
  await refreshWorlds();
}

// ---------- time ----------

export function setSpeed(speed: Speed): void {
  if (get().dream) return;
  if (speed !== 'pause' && get().history) exitHistory();         // time moves again: leave the past
  if (speed !== 'pause' && speed !== 'step') set({ resumeSpeed: speed });
  send({ type: 'speed', speed });
}
export function togglePause(): void { const s = get(); setSpeed(s.speed === 'pause' || s.speed === 'step' ? s.resumeSpeed : 'pause'); }
export function step(): void { if (get().dream) return; if (get().history) exitHistory(); send({ type: 'step' }); }

// ---------- villages ----------

export function selectVillage(id: number | undefined): void {
  set({ selected: id, detail: id === get().selected ? get().detail : undefined });
  if (id !== undefined) { requestVillage(id, true); pushSettings(); }
  const h = get().history; if (h) void seek(h.target);
  refreshScene();
}
export function focusVillage(id: number): void {
  const f = get().frame; const v = f?.villages.find(x => x.id === id); if (!v) return;
  const [x, y] = tileXY(v.tile); set({ center: { x: x + 0.5, y: y + 0.5 } });
  if (get().zoom === 'world') set({ zoom: 'local' });
  selectVillage(id);
}
function requestVillage(id: number, now: boolean): void {
  const gap = 400; const dt = Date.now() - lastVillageRequest;
  if (now || dt >= gap) { lastVillageRequest = Date.now(); send({ type: 'requestVillage', id }); return; }
  if (villageTimer === undefined) villageTimer = window.setTimeout(() => { villageTimer = undefined; lastVillageRequest = Date.now(); send({ type: 'requestVillage', id }); }, gap - dt);
}

export function setZoom(zoom: Zoom): void { set({ zoom }); refreshScene(); }
export function setCenter(x: number, y: number): void { set({ center: { x, y } }); refreshScene(); }

// ---------- settings ----------

export function updateSettings(patch: Partial<Settings>): void {
  const s = { ...get().settings, ...patch }; set({ settings: s });
  try { localStorage.setItem('ws.settings', JSON.stringify({ modelVillages: s.modelVillages, autoPause: s.autoPause, tier: s.tier })); } catch { /* ignore */ }
  pushSettings();
}
/** Focused villages: the one open plus the ones spoken to, newest first, at most three. */
function pushSettings(): void {
  const s = get(); const focused: number[] = [];
  if (s.selected !== undefined) focused.push(s.selected);
  for (const id of [...s.talkedTo].reverse()) if (!focused.includes(id) && focused.length < 3) focused.push(id);
  const settings = { ...s.settings, focused }; set({ settings });
  send({ type: 'settings', settings });
}
function markTalked(id: number): void { set(s => ({ talkedTo: [...s.talkedTo.filter(x => x !== id), id] })); pushSettings(); }

// ---------- the spirit ----------

export function queueInput(input: Input): void { send({ type: 'queue', input }); }

export function whisper(village: number, text: string): void {
  const t = text.trim(); if (!t) return;
  queueInput({ type: 'SpiritSpoke', village, text: t }); markTalked(village);
  audio.spirit('message', (get().frame?.breath ?? 100) / 100);
  toast('Your words ride the wind; the chief will hear them this week.', 'info', village);
}

export function breathe(action: BreathAction): boolean {
  const f = get().frame; if (!f) return false;
  const cost = action.kind === 'nudge' ? P.breathNudge : action.kind === 'override' ? P.breathOverride : action.kind === 'storm' ? P.breathStorm : P.breathSail;
  if (f.breath * 1000 < cost) { toast('Not enough breath.', 'error'); return false; }
  queueInput({ type: 'SpiritBreathed', action });
  audio.spirit(action.kind, Math.max(0, f.breath - cost / 1000) / 100);
  if (get().speed === 'pause') toast('The breath is drawn; it takes hold when the week turns.', 'info');
  return true;
}
export function setTargeting(on: boolean): void { set({ targeting: on }); }
export function stormAt(tile: number): void { set({ targeting: false }); breathe({ kind: 'storm', tile }); }

export function dreamStart(village: number): void {
  if (get().dream) return;
  send({ type: 'dreamStart', village }); markTalked(village);
  audio.spirit('dream-open', 1);
  set({ dream: { village, turns: [], streaming: '', busy: false, closing: false } });
}
export function dreamSend(text: string): void {
  const d = get().dream; const t = text.trim(); if (!d || d.busy || !t) return;
  set({ dream: { ...d, turns: [...d.turns, { role: 'spirit', text: t }], busy: true, streaming: '' } });
  send({ type: 'dreamSend', text: t });
}
export function dreamClose(): void {
  const d = get().dream; if (!d) return;
  if (!d.turns.length) { set({ dream: undefined }); send({ type: 'dreamClose' }); return; }
  set({ dream: { ...d, closing: true } }); send({ type: 'dreamClose' });
}
export function openWhisper(village: number | undefined): void { set({ whisperFor: village }); }

// ---------- the sun spirit ----------

export const SUN_QUESTIONS_A_YEAR = 3;
let sunSeq = 0;
export function sunQuestionsLeft(s: GameState): number {
  const year = s.frame ? Math.floor(s.frame.tick / WEEKS_PER_YEAR) : 0;
  const used = s.sun.turns.filter(t => Math.floor(t.tick / WEEKS_PER_YEAR) === year).length + (s.sun.asking ? 1 : 0);
  return Math.max(0, SUN_QUESTIONS_A_YEAR - used);
}
export function openSun(open: boolean): void { set(s => ({ sun: { ...s.sun, open } })); }
export function askSunSpirit(question: string): void {
  const s = get(); const q = question.trim(); if (!q || s.sun.asking || !s.frame || sunQuestionsLeft(s) <= 0) return;
  const id = ++sunSeq;
  set({ sun: { ...s.sun, asking: { id, question: q, streaming: '' } } });
  send({ type: 'sun', id, question: q, before: s.sun.turns });
}

// ---------- overview (every village at once, and the charts) ----------

const seriesWaiters = new Map<number, (p: SeriesPoint | undefined) => void>();
let backfilling = false;

export function setTechOpen(open: boolean): void { set({ techOpen: open }); }
export function openOverview(): void { set({ overview: true }); void backfillSeries(); }
export function closeOverview(): void { set({ overview: false }); }

/** Older saves have snapshots but no series: read each yearly snapshot once, in the history worker, and keep the readings. */
async function backfillSeries(): Promise<void> {
  const w = get().world; if (!w || backfilling) return;
  backfilling = true;
  try {
    const d = await ensureDb(); await persister?.flush();
    const have = new Set(get().series.map(p => p.tick));
    const ticks = (await snapshotTicks(d, w.id)).filter(t => t % WEEKS_PER_YEAR === 0 && !have.has(t));
    if (!ticks.length) return;
    set({ seriesBackfill: { done: 0, total: ticks.length } });
    for (let i = 0; i < ticks.length; i++) {
      if (get().world?.id !== w.id) return;
      const text = await loadSnapshotText(d, w.id, ticks[i]); if (!text) continue;
      const seq = -(1_000_000 + ticks[i]);   // negative: never collides with a seek
      const point = await new Promise<SeriesPoint | undefined>(resolve => { seriesWaiters.set(seq, resolve); ensureHistoryWorker().postMessage({ type: 'series', seq, snapshot: text } satisfies ToHistory); });
      if (point) { set(s => ({ series: [...s.series.filter(p => p.tick !== point.tick), point].sort((a, b) => a.tick - b.tick) })); await saveSeries(d, w.id, point); }
      set({ seriesBackfill: { done: i + 1, total: ticks.length } });
    }
  } finally { backfilling = false; set({ seriesBackfill: undefined }); }
}

// ---------- history (the scrubber) ----------

function ensureHistoryWorker(): Worker {
  if (historyWorker) return historyWorker;
  historyWorker = new Worker(new URL('../sim/history.worker.ts', import.meta.url), { type: 'module' });
  historyWorker.onmessage = (ev: MessageEvent<FromHistory>) => {
    const m = ev.data; if (m.seq !== seekSeq && !seriesWaiters.has(m.seq)) return;                 // a newer seek superseded this one
    if (m.type === 'series') { seriesWaiters.get(m.seq)?.(m.point); seriesWaiters.delete(m.seq); return; }
    const h = get().history; if (!h) return;
    if (m.type === 'error') { if (seriesWaiters.has(m.seq)) { seriesWaiters.get(m.seq)?.(undefined); seriesWaiters.delete(m.seq); return; } toast(`History: ${m.message}`, 'error'); set({ history: { ...h, loading: false } }); return; }
    set({ history: { ...h, tick: m.tick, frame: m.frame, detail: m.detail, loading: false } });
  };
  historyWorker.onerror = e => toast(`History worker error: ${e.message}`, 'error');
  return historyWorker;
}

/** Enter history mode at the present moment. The live sim pauses and stays paused; the scrubber replays the past. */
export function enterHistory(): void {
  const s = get(); if (!s.frame || !s.world || s.dream) return;
  if (s.speed !== 'pause') setSpeed('pause');
  set({ history: { target: s.frame.tick, tick: s.frame.tick, frame: s.frame, detail: s.detail, loading: false } });
}
export function exitHistory(): void { set({ history: undefined }); refreshScene(); }
/** Move the scrubber; the seek itself is debounced so dragging stays smooth. */
export function scrubTo(tick: number): void {
  const h = get().history; if (!h) return;
  const t = Math.max(0, Math.min(get().frame?.tick ?? tick, Math.round(tick)));
  set({ history: { ...h, target: t, loading: true } });
  if (seekTimer !== undefined) window.clearTimeout(seekTimer);
  seekTimer = window.setTimeout(() => { seekTimer = undefined; void seek(t); }, 120);
}
async function seek(tick: number): Promise<void> {
  const s = get(); const w = s.world; if (!w || !s.history) return;
  const d = await ensureDb(); await persister?.flush();
  const seq = ++seekSeq;
  const win = await loadHistoryWindow(d, w.id, tick);
  if (!win) { toast('No snapshot covers that week yet.', 'error'); set(st => st.history ? { history: { ...st.history, loading: false } } : {}); return; }
  const villageEvents = s.selected !== undefined ? (await loadEvents(d, w.id, 0, tick, s.selected)).slice(-200) : [];
  if (seq !== seekSeq) return;
  const msg: ToHistory = { type: 'seek', seq, snapshot: win.snapshot, snapshotTick: win.snapshotTick, inputs: win.inputs, targetTick: tick, village: s.selected, villageEvents };
  ensureHistoryWorker().postMessage(msg);
}
/** The frame and detail to render: the replayed past in history mode, the live world otherwise. */
export function viewFrame(s: GameState): Frame | undefined { return s.history?.frame ?? s.frame; }
export function viewDetail(s: GameState): VillageDetail | undefined { return s.history ? s.history.detail : s.detail; }
export function tickLabel(tick: number): string { return `Year ${Math.floor(tick / WEEKS_PER_YEAR)}, ${['spring', 'summer', 'autumn', 'winter'][seasonOf(tick)]} week ${(tick % 13) + 1}`; }

// ---------- narrative ----------

export function narrativeKey(village: number, span: NarrativeSpan, style: NarrativeStyle, toTick: number): string { return `${village}:${span}:${style}:${toTick}`; }
/** Ask the capable model for the story of a village over a span, cached per span. Runs in the sim worker, where the World lives. */
export async function tellStory(village: number, span: NarrativeSpan, style: NarrativeStyle): Promise<void> {
  const s = get(); const w = s.world; const toTick = s.history?.tick ?? s.frame?.tick; if (!w || toTick === undefined) return;
  const det = viewDetail(s); const founded = det && det.id === village ? det.view.village.founded * WEEKS_PER_YEAR : 0;
  const fromTick = span === 'all' ? founded : Math.max(founded, toTick - (span === 'y10' ? 10 : 50) * WEEKS_PER_YEAR);
  const key = narrativeKey(village, span, style, toTick);
  if (s.narratives[key]?.text) return;
  set(st => ({ narratives: { ...st.narratives, [key]: { loading: true, fromTick, toTick } } }));
  try {
    const d = await ensureDb(); await persister?.flush();
    const events = await loadEvents(d, w.id, fromTick, toTick, village);
    const journals = get().journals.filter(j => j.village === village && j.tick >= fromTick && j.tick < toTick);
    const id = ++narrativeSeq; narrativeWaiters.set(id, key);
    send({ type: 'narrate', request: { id, village, fromTick, toTick, style, events, journals } });
  } catch (e) { set(st => ({ narratives: { ...st.narratives, [key]: { loading: false, fromTick, toTick, error: (e as Error)?.message ?? String(e) } } })); }
}

// ---------- audio ----------

export function updateAudio(patch: Partial<AudioSettings>): void { audio.update(patch); set({ audioSettings: audio.settings }); }
/** What is on screen, for the ambient bed: season, roll, dominant terrain, zoom and speed. */
export function refreshScene(): void {
  const s = get(); const m = s.map; const f = viewFrame(s); if (!m || !f) return;
  const v = s.selected !== undefined ? f.villages.find(x => x.id === s.selected) : undefined;
  audio.scene({ season: f.season as 0 | 1 | 2 | 3, roll: f.rolls[0] ?? 'normal', biome: dominantTerrain(m.terrain, m.width, m.height, s.zoom, s.center, v?.tile), zoom: s.zoom, speed: s.history ? 'pause' : s.speed });
}
function soundTick(frame: Frame, events: Event[]): void {
  const s = get(); if (s.history) return;
  const focused = s.selected ?? null;
  audio.tick(frame.tick, events, focused);
  for (const p of frame.parties) if (!knownParties.has(p.id) && p.boat) audio.boat();
  knownParties = new Set(frame.parties.map(p => p.id));
  const v = focused !== null ? frame.villages.find(x => x.id === focused) : undefined; const d = s.detail && s.detail.id === focused ? s.detail : undefined;
  audio.village(v && v.alive ? { population: v.pop.total, building: d?.view.orders.some(o => o.includes(' build ')) ?? false, famine: v.hungryWeek > 0, hasInstruments: d?.view.stores.some(st => st.category === 'instrument') ?? false, festival: false } : null);
  if (frame.tick % 13 === 0) refreshScene();
}

// ---------- text helpers ----------

export function villageName(id: number | undefined): string { if (id === undefined) return ''; return get().frame?.villages.find(v => v.id === id)?.name ?? `village ${id}`; }
function villageOf(e: Event): number | undefined { const a = e as unknown as Record<string, unknown>; return typeof a.village === 'number' ? a.village : typeof a.defender === 'number' ? a.defender : undefined; }

export function eventText(e: Event): string {
  const n = (id: number) => villageName(id);
  switch (e.type) {
    case 'RaidResolved': return `Raiders from ${n(e.attacker)} ${e.success ? 'struck' : 'were driven off at'} ${n(e.defender)}${e.destroyed ? '; the village is destroyed' : ''}.`;
    case 'Famine': return `${e.hungry} people go hungry in ${n(e.village)}.`;
    case 'ChiefSucceeded': return `${n(e.village)} has a new chief (${e.reason === 'coup' ? 'the village lost patience' : 'after a death'}).`;
    case 'VillageFounded': return `${n(e.village)} is founded by people from ${n(e.parent)}.`;
    case 'VillageDied': return `${n(e.village)} is no more.`;
    case 'VillageAbandoned': return `The people of ${n(e.village)} abandon it and set out for ${n(e.to)}, ${e.size} of them.`;
    case 'RefugeesAdmitted': return `${n(e.village)} takes in ${e.size} people from ${n(e.from)}.`;
    case 'RefugeesTurnedAway': return `${n(e.village)} turns away ${e.size} people from ${n(e.from)}.`;
    case 'Prayer': return `The chief of ${n(e.village)} prays: "${e.text}"`;
    case 'StormStruck': return `A storm strikes: ${e.parties} part${e.parties === 1 ? 'y' : 'ies'} caught, ${e.drowned} lost.`;
    case 'Discovered': return `${n(e.village)} discovered ${get().map?.names.recipes[e.recipe] ?? e.recipe}.`;
    default: return e.type;
  }
}
function breathText(a: BreathAction, cost: number): string {
  const c = Math.round(cost / 1000);
  if (a.kind === 'nudge') return `You nudged a coming season ${a.direction} (${c} breath).`;
  if (a.kind === 'override') return `You set a coming season to ${a.roll} (${c} breath).`;
  if (a.kind === 'storm') return `A storm gathers over the chosen tile (${c} breath).`;
  return `You ${a.mode === 'fill' ? 'filled' : 'becalmed'} a boat's sails (${c} breath).`;
}

// ---------- keyboard and unload ----------

export function installGlobalHandlers(): void {
  window.addEventListener('keydown', e => {
    const s = get(); if (s.screen !== 'game' || s.dream) return;
    const tag = (e.target as HTMLElement)?.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === ' ') { e.preventDefault(); togglePause(); }
    else if (e.key === '.') { e.preventDefault(); step(); }
    else if (e.key === '1') setSpeed('slow'); else if (e.key === '2') setSpeed('normal'); else if (e.key === '3') setSpeed('fast'); else if (e.key === '4') setSpeed('veryfast');
    else if (e.key === 'Escape') { if (get().history) exitHistory(); set({ targeting: false, whisperFor: undefined }); }
  });
  const save = () => { if (get().screen === 'game') send({ type: 'snapshot', reason: 'unload' }); };
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
}
