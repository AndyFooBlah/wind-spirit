/**
 * Saves. One IndexedDB database with four tables:
 *   worlds    — id, name, seed, createdAt, lastTick, options
 *   snapshots — [world, tick] → snapshot JSON (every 52 ticks, on pause, on unload)
 *   inputs    — [world, tick] → the inputs applied at that tick (spirit inputs, chief decisions, memory side effects)
 *   journals  — autoincrement seq, indexed by world and by [world, village]
 *   events    — [world, tick] → the history-worthy events of that tick (village feeds at any point in time, narratives)
 * Resume = latest snapshot + replay of the inputs after it (no model calls). The history scrubber reads the same tables.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Event } from '@wind-spirit/sim';
import type { JournalEntry, LoggedInput, GenOpts, SeriesPoint } from '../sim/protocol.ts';
import { touches } from '../sim/views.ts';

export interface WorldMeta { id: string; name: string; seed: string; createdAt: number; lastTick: number; options: GenOpts; updatedAt: number; }
export interface SnapshotRow { world: string; tick: number; json?: string; gz?: ArrayBuffer; savedAt: number; reason: string; }

/** Snapshots are gzip-compressed at rest: a 128 × 128 world is ~4 MB as JSON and ~300 KB compressed. Old rows may still carry plain json. */
async function gzip(text: string): Promise<ArrayBuffer> { return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(); }
async function gunzip(buf: ArrayBuffer): Promise<string> { return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
async function snapshotText(row: SnapshotRow): Promise<string> { return row.gz ? gunzip(row.gz) : (row.json ?? ''); }
export interface InputRow { world: string; tick: number; inputs: LoggedInput[]; }
export interface JournalRow { seq?: number; world: string; village: number; entry: JournalEntry; }
export interface EventRow { world: string; tick: number; events: Event[]; }
export interface SeriesRow { world: string; tick: number; point: SeriesPoint; }
export interface SunRow { seq?: number; world: string; tick: number; question: string; answer: string; }

interface Schema extends DBSchema {
  worlds: { key: string; value: WorldMeta; indexes: { byUpdated: number } };
  snapshots: { key: [string, number]; value: SnapshotRow; indexes: { byWorld: string } };
  inputs: { key: [string, number]; value: InputRow; indexes: { byWorld: string } };
  journals: { key: number; value: JournalRow; indexes: { byWorld: string; byVillage: [string, number] } };
  events: { key: [string, number]; value: EventRow; indexes: { byWorld: string } };
  series: { key: [string, number]; value: SeriesRow; indexes: { byWorld: string } };
  sun: { key: number; value: SunRow; indexes: { byWorld: string } };
}

export const DB_NAME = 'wind-spirit';
export const DB_VERSION = 4;

export type Db = IDBPDatabase<Schema>;

/** Called when another tab holds an older version open and the upgrade cannot proceed (the UI shows a message). */
export let onStoreBlocked: (() => void) | undefined;
export function setStoreBlockedHandler(f: () => void): void { onStoreBlocked = f; }

export function openStore(name = DB_NAME): Promise<Db> {
  return openDB<Schema>(name, DB_VERSION, {
    blocked() { onStoreBlocked?.(); },
    // A newer version of the app opened the database in another tab: close this connection so its upgrade can go ahead.
    blocking(_current, _blocked, event) { (event.target as IDBDatabase | null)?.close(); },
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const worlds = db.createObjectStore('worlds', { keyPath: 'id' }); worlds.createIndex('byUpdated', 'updatedAt');
        const snaps = db.createObjectStore('snapshots', { keyPath: ['world', 'tick'] }); snaps.createIndex('byWorld', 'world');
        const inputs = db.createObjectStore('inputs', { keyPath: ['world', 'tick'] }); inputs.createIndex('byWorld', 'world');
        const journals = db.createObjectStore('journals', { keyPath: 'seq', autoIncrement: true }); journals.createIndex('byWorld', 'world'); journals.createIndex('byVillage', ['world', 'village']);
      }
      if (oldVersion < 2) { const events = db.createObjectStore('events', { keyPath: ['world', 'tick'] }); events.createIndex('byWorld', 'world'); }
      if (oldVersion < 3) { const series = db.createObjectStore('series', { keyPath: ['world', 'tick'] }); series.createIndex('byWorld', 'world'); }
      if (oldVersion < 4) { const sun = db.createObjectStore('sun', { keyPath: 'seq', autoIncrement: true }); sun.createIndex('byWorld', 'world'); }
    },
  });
}

export const newWorldId = (): string => `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export async function listWorlds(db: Db): Promise<WorldMeta[]> {
  const all = await db.getAll('worlds'); return all.sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function createWorld(db: Db, meta: Omit<WorldMeta, 'createdAt' | 'updatedAt' | 'lastTick'>): Promise<WorldMeta> {
  const row: WorldMeta = { ...meta, createdAt: Date.now(), updatedAt: Date.now(), lastTick: 0 };
  await db.put('worlds', row); return row;
}
export async function deleteWorld(db: Db, id: string): Promise<void> {
  const tx = db.transaction(['worlds', 'snapshots', 'inputs', 'journals', 'events'], 'readwrite');
  await tx.objectStore('worlds').delete(id);
  for (const store of ['snapshots', 'inputs', 'journals', 'events'] as const) {
    const idx = tx.objectStore(store).index('byWorld');
    let cur = await idx.openKeyCursor(IDBKeyRange.only(id));
    while (cur) { await tx.objectStore(store).delete(cur.primaryKey as never); cur = await cur.continue(); }
  }
  await tx.done;
}

export async function saveSnapshot(db: Db, world: string, tick: number, json: string, reason: string): Promise<void> {
  const gz = await gzip(json);
  await db.put('snapshots', { world, tick, gz, savedAt: Date.now(), reason });
}

/** Record a tick: its inputs and history-worthy events (if any) and the world's new current tick, in one transaction. */
export async function saveTick(db: Db, world: string, tick: number, inputs: LoggedInput[], events: Event[] = []): Promise<void> {
  const tx = db.transaction(['inputs', 'worlds', 'events'], 'readwrite');
  if (inputs.length) await tx.objectStore('inputs').put({ world, tick, inputs });
  if (events.length) await tx.objectStore('events').put({ world, tick, events });
  const meta = await tx.objectStore('worlds').get(world);
  if (meta) { meta.lastTick = tick + 1; meta.updatedAt = Date.now(); await tx.objectStore('worlds').put(meta); }
  await tx.done;
}

export async function saveJournal(db: Db, world: string, entry: JournalEntry): Promise<void> {
  await db.add('journals', { world, village: entry.village, entry });
}
export async function loadJournals(db: Db, world: string): Promise<JournalEntry[]> {
  const rows = await db.getAllFromIndex('journals', 'byWorld', world); return rows.map(r => r.entry);
}

/** A village's stored events with fromTick <= t < toTick, oldest first (weather rolls count for every village). */
export async function loadEvents(db: Db, world: string, fromTick: number, toTick: number, village?: number): Promise<Event[]> {
  if (toTick <= fromTick) return [];
  const rows = await db.getAll('events', IDBKeyRange.bound([world, fromTick], [world, toTick - 1]));
  const out: Event[] = [];
  for (const r of rows) for (const e of r.events) if (village === undefined || e.type === 'WeatherRolled' || touches(e, village)) out.push(e);
  return out;
}

/** The nearest snapshot at or before `tick` plus the inputs logged from it up to (excluding) `tick`, for the history worker. */
export async function loadHistoryWindow(db: Db, world: string, tick: number): Promise<{ snapshot: string; snapshotTick: number; inputs: Record<number, LoggedInput[]> } | undefined> {
  const snaps = await db.getAllFromIndex('snapshots', 'byWorld', world);
  const snap = snaps.filter(s => s.tick <= tick).sort((a, b) => b.tick - a.tick)[0]; if (!snap) return undefined;
  const rows = snap.tick < tick ? await db.getAll('inputs', IDBKeyRange.bound([world, snap.tick], [world, tick - 1])) : [];
  const inputs: Record<number, LoggedInput[]> = {}; for (const r of rows) inputs[r.tick] = r.inputs;
  return { snapshot: await snapshotText(snap), snapshotTick: snap.tick, inputs };
}
export async function saveSun(db: Db, world: string, tick: number, question: string, answer: string): Promise<void> { await db.add('sun', { world, tick, question, answer }); }
export async function loadSun(db: Db, world: string): Promise<SunRow[]> { return (await db.getAllFromIndex('sun', 'byWorld', world)).sort((a, b) => a.tick - b.tick); }
export async function saveSeries(db: Db, world: string, point: SeriesPoint): Promise<void> { await db.put('series', { world, tick: point.tick, point }); }
export async function loadSeries(db: Db, world: string): Promise<SeriesPoint[]> { return (await db.getAllFromIndex('series', 'byWorld', world)).map(r => r.point).sort((a, b) => a.tick - b.tick); }
/** The gunzipped text of one stored snapshot, for the overview backfill. */
export async function loadSnapshotText(db: Db, world: string, tick: number): Promise<string | undefined> { const row = await db.get('snapshots', [world, tick]); return row ? snapshotText(row) : undefined; }
export async function snapshotTicks(db: Db, world: string): Promise<number[]> { return (await db.getAllFromIndex('snapshots', 'byWorld', world)).map(s => s.tick).sort((a, b) => a - b); }

export interface ResumeData { snapshot: string; snapshotTick: number; inputsAfter: LoggedInput[][]; lastTick: number; }

/** Latest snapshot at or before lastTick plus the per-tick inputs from the snapshot tick up to lastTick - 1. */
export async function loadResume(db: Db, world: string): Promise<ResumeData | undefined> {
  const meta = await db.get('worlds', world); if (!meta) return undefined;
  const snaps = await db.getAllFromIndex('snapshots', 'byWorld', world);
  const usable = snaps.filter(s => s.tick <= meta.lastTick).sort((a, b) => b.tick - a.tick);
  const snap = usable[0]; if (!snap) return undefined;
  const rows = snap.tick < meta.lastTick ? await db.getAll('inputs', IDBKeyRange.bound([world, snap.tick], [world, meta.lastTick - 1])) : [];
  const inputsAfter: LoggedInput[][] = [];
  for (let t = snap.tick; t < meta.lastTick; t++) inputsAfter.push([]);
  for (const r of rows) if (r.tick >= snap.tick && r.tick < meta.lastTick) inputsAfter[r.tick - snap.tick] = r.inputs;
  return { snapshot: await snapshotText(snap), snapshotTick: snap.tick, inputsAfter, lastTick: meta.lastTick };
}

/** Serialises writes so a snapshot and the ticks around it land in order. */
export class Persister {
  private chain: Promise<void> = Promise.resolve();
  constructor(private db: Db, readonly world: string) {}
  private run(f: () => Promise<void>): Promise<void> { this.chain = this.chain.then(f, f).catch(e => console.error('persist', e)); return this.chain; }
  tick(tick: number, inputs: LoggedInput[], events: Event[] = []): Promise<void> { return this.run(() => saveTick(this.db, this.world, tick, inputs, events)); }
  snapshot(tick: number, json: string, reason: string): Promise<void> { return this.run(() => saveSnapshot(this.db, this.world, tick, json, reason)); }
  journal(entry: JournalEntry): Promise<void> { return this.run(() => saveJournal(this.db, this.world, entry)); }
  flush(): Promise<void> { return this.chain; }
}
