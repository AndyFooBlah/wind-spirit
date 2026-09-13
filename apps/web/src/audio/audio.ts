/**
 * The audio engine's place in the app: created only after a user gesture, fed from the worker's ticks, faders and
 * mutes persisted in localStorage. Exposed on window.__wsAudio for inspection (there is no other way to "hear" it in tests).
 */
import { createAudioEngine, cueFor, BUSES, type AudioEngine, type Bus, type Scene, type VillageState, type SpiritKind, type MusicIntensity } from '@wind-spirit/audio';
import type { Event, Terrain } from '@wind-spirit/sim';

export interface AudioSettings { muteAll: boolean; music: boolean; gains: Record<Bus, number>; mutes: Record<Bus, boolean>; }
export const DEFAULT_AUDIO: AudioSettings = {
  muteAll: false, music: true,
  gains: { master: 0.8, ambient: 0.9, village: 0.9, markers: 0.7, events: 1, spirit: 1, music: 0.7 },
  mutes: { master: false, ambient: false, village: false, markers: false, events: false, spirit: false, music: false },
};
const KEY = 'ws.audio';

export function loadAudioSettings(): AudioSettings {
  try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw) as Partial<AudioSettings>; return { ...DEFAULT_AUDIO, ...s, gains: { ...DEFAULT_AUDIO.gains, ...(s.gains ?? {}) }, mutes: { ...DEFAULT_AUDIO.mutes, ...(s.mutes ?? {}) } }; } } catch { /* ignore */ }
  return DEFAULT_AUDIO;
}
function persist(s: AudioSettings): void { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

export interface AudioDebug { engine?: AudioEngine; fed: number; cues: string[]; spirit: string[]; }

class AppAudio {
  private engine?: AudioEngine;
  private seed = '';
  private gestured = false;
  private pendingScene?: Scene;
  settings: AudioSettings = loadAudioSettings();
  readonly debug: AudioDebug = { fed: 0, cues: [], spirit: [] };
  private intensityUntil = 0; private intensity: MusicIntensity = 'melody';

  constructor() {
    if (typeof window !== 'undefined') {
      const gesture = () => { this.gestured = true; this.ensure(); };
      window.addEventListener('pointerdown', gesture, { once: true, capture: true });
      window.addEventListener('keydown', gesture, { once: true, capture: true });
      (window as unknown as { __wsAudio: AudioDebug }).__wsAudio = this.debug;
    }
  }

  /** A world is open: (re)create the engine for its seed once a gesture has happened. */
  setWorld(seed: string): void {
    if (seed === this.seed) return;
    this.seed = seed; this.dispose(); this.ensure();
  }
  private ensure(): void {
    if (this.engine || !this.gestured || !this.seed || this.settings.muteAll) return;
    const e = createAudioEngine({ seed: this.seed }); this.engine = e; this.debug.engine = e;
    this.applySettings();
    if (this.pendingScene) e.setScene(this.pendingScene);
    e.setMusic({ enabled: this.settings.music, intensity: this.intensity });
    void e.resume();
  }
  dispose(): void { this.engine?.dispose(); this.engine = undefined; this.debug.engine = undefined; }

  private applySettings(): void {
    const e = this.engine; if (!e) return;
    for (const b of BUSES) { e.setBusGain(b, this.settings.gains[b]); e.mute(b, this.settings.mutes[b]); }
    e.setMusic({ enabled: this.settings.music, intensity: this.intensity });
  }
  update(patch: Partial<AudioSettings>): void {
    const was = this.settings.muteAll;
    this.settings = { ...this.settings, ...patch, gains: { ...this.settings.gains, ...(patch.gains ?? {}) }, mutes: { ...this.settings.mutes, ...(patch.mutes ?? {}) } };
    persist(this.settings);
    if (this.settings.muteAll) { void this.engine?.suspend(); return; }
    if (was && !this.settings.muteAll) { this.gestured = true; if (this.engine) void this.engine.resume(); else this.ensure(); }
    this.applySettings();
  }

  scene(s: Scene): void { this.pendingScene = s; this.engine?.setScene(s); }
  village(v: VillageState | null): void { this.engine?.setVillage(v); }
  tick(t: number, events: Event[], focused: number | null): void {
    const e = this.engine;
    this.debug.fed += events.length;
    for (const ev of events) { const c = cueFor(ev); if (c) { this.debug.cues.push(`${t}:${c.sound}`); if (this.debug.cues.length > 200) this.debug.cues.splice(0, this.debug.cues.length - 200); } }
    // music follows the story of the focused village
    for (const ev of events) {
      if (ev.type === 'RaidResolved' && (focused === null || ev.defender === focused || ev.attacker === focused)) { this.intensity = 'tension'; this.intensityUntil = t + 8; }
      else if (ev.type === 'ChiefSucceeded' && ev.reason === 'death' && (focused === null || ev.village === focused) && this.intensity !== 'tension') { this.intensity = 'lament'; this.intensityUntil = t + 16; }
    }
    if (t >= this.intensityUntil && this.intensity !== 'melody') { this.intensity = 'melody'; e?.setMusic({ enabled: this.settings.music, intensity: 'melody' }); }
    else if (this.intensity !== 'melody') e?.setMusic({ enabled: this.settings.music, intensity: this.intensity });
    if (!e) return;
    e.tick(t); e.onEvents(events, focused);
  }
  spirit(kind: SpiritKind, pool: number): void { this.debug.spirit.push(kind); this.engine?.spirit(kind, pool); }
  boat(): void { this.engine?.play('boat'); }
  running(): boolean { return this.engine?.snapshot().contextState === 'running'; }
}

export const audio = new AppAudio();

/** The most common terrain among the tiles a viewport shows; the village zoom is its own tile. */
export function dominantTerrain(terrain: Terrain[], width: number, height: number, zoom: 'world' | 'region' | 'local' | 'village', center: { x: number; y: number }, villageTile?: number): Terrain {
  if (zoom === 'village' && villageTile !== undefined) return terrain[villageTile] ?? 'grass';
  const r = zoom === 'world' ? Math.max(width, height) : zoom === 'region' ? 18 : 7;
  const counts = new Map<Terrain, number>();
  const cx = Math.floor(center.x), cy = Math.floor(center.y);
  for (let y = Math.max(0, cy - r); y <= Math.min(height - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(width - 1, cx + r); x++) { const t = terrain[y * width + x]; counts.set(t, (counts.get(t) ?? 0) + 1); }
  let best: Terrain = 'grass', n = -1; for (const [t, c] of counts) if (c > n) { best = t; n = c; }
  return best;
}
