/**
 * Saves. One IndexedDB database with four tables:
 *   worlds    — id, name, seed, createdAt, lastTick, options
 *   snapshots — [world, tick] → snapshot JSON (every 52 ticks, on pause, on unload)
 *   inputs    — [world, tick] → the inputs applied at that tick (spirit inputs, chief decisions, memory side effects)
 *   journals  — autoincrement seq, indexed by world and by [world, village]
 * Resume = latest snapshot + replay of the inputs after it (no model calls). M5's scrubber reads the same tables.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { JournalEntry, LoggedInput, GenOpts } from '../sim/protocol.ts';

export interface WorldMeta { id: string; name: string; seed: string; createdAt: number; lastTick: number; options: GenOpts; updatedAt: number; }
export interface SnapshotRow { world: string; tick: number; json: string; savedAt: number; reason: string; }
export interface InputRow { world: string; tick: number; inputs: LoggedInput[]; }
export interface JournalRow { seq?: number; world: string; village: number; entry: JournalEntry; }

interface Schema extends DBSchema {
  worlds: { key: string; value: WorldMeta; indexes: { byUpdated: number } };
  snapshots: { key: [string, number]; value: SnapshotRow; indexes: { byWorld: string } };
  inputs: { key: [string, number]; value: InputRow; indexes: { byWorld: string } };
  journals: { key: number; value: JournalRow; indexes: { byWorld: string; byVillage: [string, number] } };
}

export const DB_NAME = 'wind-spirit';
export const DB_VERSION = 1;

export type Db = IDBPDatabase<Schema>;

export function openStore(name = DB_NAME): Promise<Db> {
  return openDB<Schema>(name, DB_VERSION, {
    upgrade(db) {
      const worlds = db.createObjectStore('worlds', { keyPath: 'id' }); worlds.createIndex('byUpdated', 'updatedAt');
      const snaps = db.createObjectStore('snapshots', { keyPath: ['world', 'tick'] }); snaps.createIndex('byWorld', 'world');
      const inputs = db.createObjectStore('inputs', { keyPath: ['world', 'tick'] }); inputs.createIndex('byWorld', 'world');
      const journals = db.createObjectStore('journals', { keyPath: 'seq', autoIncrement: true }); journals.createIndex('byWorld', 'world'); journals.createIndex('byVillage', ['world', 'village']);
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
  const tx = db.transaction(['worlds', 'snapshots', 'inputs', 'journals'], 'readwrite');
  await tx.objectStore('worlds').delete(id);
  for (const store of ['snapshots', 'inputs', 'journals'] as const) {
    const idx = tx.objectStore(store).index('byWorld');
    let cur = await idx.openKeyCursor(IDBKeyRange.only(id));
    while (cur) { await tx.objectStore(store).delete(cur.primaryKey as never); cur = await cur.continue(); }
  }
  await tx.done;
}

export async function saveSnapshot(db: Db, world: string, tick: number, json: string, reason: string): Promise<void> {
  await db.put('snapshots', { world, tick, json, savedAt: Date.now(), reason });
}

/** Record a tick: its inputs (if any) and the world's new current tick, in one transaction. */
export async function saveTick(db: Db, world: string, tick: number, inputs: LoggedInput[]): Promise<void> {
  const tx = db.transaction(['inputs', 'worlds'], 'readwrite');
  if (inputs.length) await tx.objectStore('inputs').put({ world, tick, inputs });
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
  return { snapshot: snap.json, snapshotTick: snap.tick, inputsAfter, lastTick: meta.lastTick };
}

/** Serialises writes so a snapshot and the ticks around it land in order. */
export class Persister {
  private chain: Promise<void> = Promise.resolve();
  constructor(private db: Db, readonly world: string) {}
  private run(f: () => Promise<void>): Promise<void> { this.chain = this.chain.then(f, f).catch(e => console.error('persist', e)); return this.chain; }
  tick(tick: number, inputs: LoggedInput[]): Promise<void> { return this.run(() => saveTick(this.db, this.world, tick, inputs)); }
  snapshot(tick: number, json: string, reason: string): Promise<void> { return this.run(() => saveSnapshot(this.db, this.world, tick, json, reason)); }
  journal(entry: JournalEntry): Promise<void> { return this.run(() => saveJournal(this.db, this.world, entry)); }
  flush(): Promise<void> { return this.chain; }
}
