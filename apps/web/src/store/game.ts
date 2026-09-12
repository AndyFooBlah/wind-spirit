/**
 * UI state (zustand) and the game controller: owns the worker, the database, auth tokens for the worker, autosave.
 * Components read the store; they call the exported actions to change the world.
 */
import { create } from 'zustand';
import type { BreathAction, Event, Input } from '@wind-spirit/sim';
import { P } from '@wind-spirit/sim';
import { idToken } from '../auth.ts';
import { DEFAULT_SETTINGS, type Frame, type FromWorker, type JournalEntry, type Settings, type Speed, type StaticMap, type ToWorker, type VillageDetail } from '../sim/protocol.ts';
import { createWorld, deleteWorld, listWorlds, loadJournals, loadResume, newWorldId, openStore, Persister, type Db, type WorldMeta } from './db.ts';

export type Zoom = 'world' | 'local' | 'village';
export interface Toast { id: number; text: string; kind: 'attention' | 'info' | 'error'; village?: number; }
export interface DreamTurn { role: 'spirit' | 'chief'; text: string; }
export interface DreamState { village: number; turns: DreamTurn[]; streaming: string; busy: boolean; closing: boolean; }

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
}

export const useGame = create<GameState>(() => ({
  screen: 'gallery', worlds: [], speed: 'pause', resumeSpeed: 'normal', journals: [], toasts: [], settings: loadSettings(), talkedTo: [],
  pendingClaims: [], zoom: 'local', center: { x: 32, y: 32 }, targeting: false, loading: '', lastEvents: [], waiting: [],
}));

const set = useGame.setState; const get = useGame.getState;

// ---------- infrastructure ----------

let db: Db | undefined; let worker: Worker | undefined; let persister: Persister | undefined; let toastSeq = 0;
let villageTimer: number | undefined; let lastVillageRequest = 0;

async function ensureDb(): Promise<Db> { return (db ??= await openStore()); }

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
    case 'loaded': { set({ frame: m.frame, loading: '' }); const v = m.frame.villages.find(x => x.alive); if (v && get().selected === undefined) { const [x, y] = tileXY(v.tile); set({ center: { x: x + 0.5, y: y + 0.5 } }); } break; }
    case 'tick': {
      set({ frame: m.frame, lastEvents: m.events });
      void persister?.tick(m.tick, m.inputs);
      const w = get().world; if (w) set({ world: { ...w, lastTick: m.tick + 1 } });
      for (const e of m.events) if (e.type === 'SpiritBreathed') toast(breathText(e.action, e.cost), 'info');
      const landed = new Set(m.events.filter(e => e.type === 'ClaimRecorded').map(e => (e as { village: number }).village));
      if (landed.size) set(s => ({ pendingClaims: s.pendingClaims.filter(c => !landed.has(c.village)) }));
      if (get().selected !== undefined) requestVillage(get().selected!, false);
      break;
    }
    case 'snapshot': void persister?.snapshot(m.tick, m.json, m.reason); break;
    case 'attention': { const text = eventText(m.event); const village = villageOf(m.event); toast(text, 'attention', village); if (village !== undefined) focusVillage(village); break; }
    case 'journal': set(s => ({ journals: [...s.journals, m.entry] })); void persister?.journal(m.entry); break;
    case 'village': if (m.detail.id === get().selected) set({ detail: m.detail }); break;
    case 'speed': set(s => ({ speed: m.speed, toasts: m.speed === 'pause' ? s.toasts : s.toasts.filter(t => t.kind !== 'attention') })); break;
    case 'waiting': set({ waiting: m.villages }); break;
    case 'needToken': void idToken().then(token => { send({ type: 'token', id: m.id, token }); set({ proxyOk: !!token }); }); break;
    case 'dreamChunk': set(s => s.dream ? { dream: { ...s.dream, streaming: s.dream.streaming + m.text } } : {}); break;
    case 'dreamReply': set(s => s.dream ? { dream: { ...s.dream, streaming: '', busy: false, turns: m.text ? [...s.dream.turns, { role: 'chief', text: m.text }] : s.dream.turns } } : {}); break;
    case 'dreamClosed': {
      const d = get().dream; set({ dream: undefined });
      if (d) { if (m.claims.length) { set(s => ({ pendingClaims: [...s.pendingClaims, { village: d.village, texts: m.claims.map(c => c.text) }] })); toast(`${m.claims.length} claim${m.claims.length === 1 ? '' : 's'} will enter the chronicle when the week turns.`, 'info', d.village); } else toast('The dream ended; the chief noted nothing to hold you to.', 'info', d.village); }
      break;
    }
    case 'error': toast(m.message, 'error', m.village); break;
  }
}

function tileXY(tile: number): [number, number] { const w = get().map?.width ?? 64; return [tile % w, Math.floor(tile / w)]; }

export function toast(text: string, kind: Toast['kind'] = 'info', village?: number): void {
  const id = ++toastSeq; set(s => ({ toasts: [...s.toasts.slice(-5), { id, text, kind, village }] }));
  // attention toasts stay until the game resumes (see the 'speed' message); the rest fade
  if (kind !== 'attention') window.setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 6000);
}
export function dismissToast(id: number): void { set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })); }

// ---------- gallery ----------

export async function refreshWorlds(): Promise<void> { const d = await ensureDb(); set({ worlds: await listWorlds(d) }); }

export async function newWorld(seed: string, name?: string): Promise<void> {
  const d = await ensureDb(); const s = seed.trim() || Math.random().toString(36).slice(2, 10);
  const meta = await createWorld(d, { id: newWorldId(), name: name?.trim() || s, seed: s, options: { width: 64, height: 64, villages: 4, startPop: 20 } });
  set({ loading: 'Shaping the world…', screen: 'game', world: meta, frame: undefined, map: undefined, selected: undefined, detail: undefined, journals: [], talkedTo: [], pendingClaims: [], speed: 'pause', zoom: 'local' });
  await startWorker(); persister = new Persister(d, meta.id);
  pushSettings();
  send({ type: 'init', seed: s, opts: meta.options });
  send({ type: 'snapshot', reason: 'start' });
  await refreshWorlds();
}

export async function continueWorld(id: string): Promise<void> {
  const d = await ensureDb(); const meta = (await listWorlds(d)).find(w => w.id === id); if (!meta) return;
  const resume = await loadResume(d, id);
  set({ loading: 'Remembering…', screen: 'game', world: meta, frame: undefined, map: undefined, selected: undefined, detail: undefined, journals: await loadJournals(d, id), talkedTo: [], pendingClaims: [], speed: 'pause', zoom: 'local' });
  await startWorker(); persister = new Persister(d, meta.id);
  pushSettings();
  if (resume) send({ type: 'load', snapshot: resume.snapshot, inputsAfter: resume.inputsAfter });
  else { send({ type: 'init', seed: meta.seed, opts: meta.options }); send({ type: 'snapshot', reason: 'start' }); }
}

export async function removeWorld(id: string): Promise<void> { const d = await ensureDb(); await deleteWorld(d, id); await refreshWorlds(); }

export async function leaveWorld(): Promise<void> {
  send({ type: 'speed', speed: 'pause' });
  await new Promise(r => setTimeout(r, 150)); await persister?.flush();
  worker?.terminate(); worker = undefined; persister = undefined;
  set({ screen: 'gallery', world: undefined, frame: undefined, map: undefined, selected: undefined, detail: undefined, dream: undefined, speed: 'pause' });
  await refreshWorlds();
}

// ---------- time ----------

export function setSpeed(speed: Speed): void {
  if (get().dream) return;
  if (speed !== 'pause' && speed !== 'step') set({ resumeSpeed: speed });
  send({ type: 'speed', speed });
}
export function togglePause(): void { const s = get(); setSpeed(s.speed === 'pause' || s.speed === 'step' ? s.resumeSpeed : 'pause'); }
export function step(): void { if (get().dream) return; send({ type: 'step' }); }

// ---------- villages ----------

export function selectVillage(id: number | undefined): void {
  set({ selected: id, detail: id === get().selected ? get().detail : undefined });
  if (id !== undefined) { requestVillage(id, true); pushSettings(); }
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

export function setZoom(zoom: Zoom): void { set({ zoom }); }
export function setCenter(x: number, y: number): void { set({ center: { x, y } }); }

// ---------- settings ----------

export function updateSettings(patch: Partial<Settings>): void {
  const s = { ...get().settings, ...patch }; set({ settings: s });
  try { localStorage.setItem('ws.settings', JSON.stringify({ modelVillages: s.modelVillages, autoPause: s.autoPause })); } catch { /* ignore */ }
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
  toast('Your words ride the wind; the chief will hear them this week.', 'info', village);
}

export function breathe(action: BreathAction): boolean {
  const f = get().frame; if (!f) return false;
  const cost = action.kind === 'nudge' ? P.breathNudge : action.kind === 'override' ? P.breathOverride : action.kind === 'storm' ? P.breathStorm : P.breathSail;
  if (f.breath * 1000 < cost) { toast('Not enough breath.', 'error'); return false; }
  queueInput({ type: 'SpiritBreathed', action });
  if (get().speed === 'pause') toast('The breath is drawn; it takes hold when the week turns.', 'info');
  return true;
}
export function setTargeting(on: boolean): void { set({ targeting: on }); }
export function stormAt(tile: number): void { set({ targeting: false }); breathe({ kind: 'storm', tile }); }

export function dreamStart(village: number): void {
  if (get().dream) return;
  send({ type: 'dreamStart', village }); markTalked(village);
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
    else if (e.key === 'Escape') { set({ targeting: false, whisperFor: undefined }); }
  });
  const save = () => { if (get().screen === 'game') send({ type: 'snapshot', reason: 'unload' }); };
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
}
