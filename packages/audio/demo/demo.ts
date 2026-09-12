/** Audition page for @wind-spirit/audio. Exposes `window.__engine` and `window.__ctx` for inspection. */
import type { Event as SimEvent, Season, SeasonRoll, Terrain } from '@wind-spirit/sim';
import {
  BUSES, createAudioEngine, SOUNDS, type AudioEngine, type MusicIntensity, type MusicSettings, type Scene, type Speed, type SpiritKind, type VillageState, type Zoom,
} from '../src/index.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (s: string) => { const el = $('log'); el.textContent = `${new Date().toLocaleTimeString()} ${s}\n${el.textContent ?? ''}`.slice(0, 6000); };

let ctx: AudioContext | null = null;
let engine: AudioEngine & { spec: ReturnType<typeof createAudioEngine>['spec'] };
let tick = 0;
const scene: Scene = { season: 0, roll: 'normal', biome: 'grass', zoom: 'local', speed: 'normal' };
const village: VillageState = { population: 40, building: false, famine: false, hasInstruments: false, festival: false };
const music: MusicSettings = { enabled: true, intensity: 'melody' };

function build(seed: string): void {
  engine?.dispose();
  ctx = new AudioContext();
  engine = createAudioEngine({ context: ctx, seed });
  (window as unknown as { __engine: unknown; __ctx: unknown }).__engine = engine;
  (window as unknown as { __ctx: unknown }).__ctx = ctx;
  const s = engine.spec;
  $('spec').textContent = `${s.scale.name} on MIDI ${s.root}, ${s.tempo} bpm, ${s.palette.lead} lead, ${s.palette.accompaniment} accompaniment, ${s.palette.drum} drum`;
  engine.setScene(scene); engine.setVillage(currentVillage()); engine.setMusic(music);
  for (const b of BUSES) { const r = $<HTMLInputElement>(`bus-${b}`); engine.setBusGain(b, Number(r.value) / 100); engine.mute(b, $<HTMLInputElement>(`mute-${b}`).checked); }
  log(`engine built for seed "${seed}"`);
}

function currentVillage(): VillageState | null { return $<HTMLInputElement>('v-none').checked ? null : { ...village }; }
function refreshStatus(): void { const s = engine?.snapshot(); $('status').textContent = s ? `${s.contextState}${s.dreaming ? ', dreaming' : ''}, coalescer pending ${s.coalescer.pending} suppressed ${s.coalescer.suppressed}` : 'not started'; }

function choice<T extends string>(host: HTMLElement, options: readonly T[], current: T, onPick: (v: T) => void): void {
  const buttons: HTMLButtonElement[] = [];
  for (const o of options) {
    const b = document.createElement('button'); b.textContent = o; b.className = o === current ? 'on' : ''; b.dataset.value = o;
    b.onclick = () => { for (const x of buttons) x.className = x === b ? 'on' : ''; onPick(o); };
    host.appendChild(b); buttons.push(b);
  }
}

// Buses
for (const b of BUSES) {
  const row = document.createElement('div'); row.className = 'bus';
  row.innerHTML = `<span>${b}</span><input id="bus-${b}" type="range" min="0" max="100" value="${b === 'master' ? 80 : 100}" /><span class="val" id="val-${b}"></span><label><input id="mute-${b}" type="checkbox" /> mute</label>`;
  $('buses').appendChild(row);
  const r = $<HTMLInputElement>(`bus-${b}`), v = $(`val-${b}`), m = $<HTMLInputElement>(`mute-${b}`);
  v.textContent = (Number(r.value) / 100).toFixed(2);
  r.oninput = () => { v.textContent = (Number(r.value) / 100).toFixed(2); engine?.setBusGain(b, Number(r.value) / 100); };
  m.onchange = () => { engine?.mute(b, m.checked); log(`mute ${b} ${m.checked}`); };
}

// Scene
const applyScene = () => { engine?.setScene(scene); log(`setScene ${JSON.stringify(scene)}`); refreshStatus(); };
choice($('season'), ['spring', 'summer', 'autumn', 'winter'], 'spring', (v) => { scene.season = ['spring', 'summer', 'autumn', 'winter'].indexOf(v) as Season; applyScene(); });
choice<SeasonRoll>($('roll'), ['drought', 'normal', 'wet', 'hard', 'storm'], 'normal', (v) => { scene.roll = v; applyScene(); });
choice<Terrain>($('biome'), ['grass', 'forest', 'hills', 'mountain', 'desert', 'oasis', 'marsh', 'river', 'lake', 'coast', 'ocean'], 'grass', (v) => { scene.biome = v; applyScene(); });
choice<Zoom>($('zoom'), ['world', 'local', 'village'], 'local', (v) => { scene.zoom = v; applyScene(); });
choice<Speed>($('speed'), ['pause', 'step', 'slow', 'normal', 'fast', 'veryfast'], 'normal', (v) => { scene.speed = v; applyScene(); });

// Village
const applyVillage = () => { engine?.setVillage(currentVillage()); log(`setVillage ${JSON.stringify(currentVillage())}`); };
$('v-none').onchange = applyVillage;
$<HTMLInputElement>('v-pop').oninput = (e) => { village.population = Number((e.target as HTMLInputElement).value); $('v-pop-val').textContent = String(village.population); applyVillage(); };
for (const [id, key] of [['v-building', 'building'], ['v-famine', 'famine'], ['v-instruments', 'hasInstruments'], ['v-festival', 'festival']] as const) {
  $<HTMLInputElement>(id).onchange = (e) => { village[key] = (e.target as HTMLInputElement).checked; applyVillage(); };
}

// Music
const applyMusic = () => { engine?.setMusic(music); log(`setMusic ${JSON.stringify(music)}`); };
$<HTMLInputElement>('m-enabled').onchange = (e) => { music.enabled = (e.target as HTMLInputElement).checked; applyMusic(); };
choice<MusicIntensity>($('m-intensity'), ['drone', 'melody', 'tension', 'lament', 'festival'], 'melody', (v) => { music.intensity = v; applyMusic(); });

// Events
for (const s of SOUNDS) {
  const b = document.createElement('button'); b.textContent = s; b.dataset.sound = s;
  b.onclick = () => { engine?.play(s); log(`play ${s}`); };
  $('events').appendChild(b);
}
const born = (v: number): SimEvent => ({ t: tick, type: 'Born', village: v, person: Math.floor(Math.random() * 1e6) });
$('six-births').onclick = () => { engine?.onEvents([born(1), born(1), born(1), born(1), born(1), born(1)], 1); log('onEvents 6× Born (village 1, focused)'); refreshStatus(); };
$('mixed-week').onclick = () => {
  const evs: SimEvent[] = [
    born(1), born(2), { t: tick, type: 'Died', village: 2, person: 3, cause: 'hunger', stage: 'adult' },
    { t: tick, type: 'Harvested', village: 1, qty: 12000, plots: 3 }, { t: tick, type: 'Discovered', village: 1, recipe: 'pottery', how: 'accident' },
    { t: tick, type: 'PartyLeft', village: 1, party: 9, kind: 'explore', size: 3 }, { t: tick, type: 'TradeCompleted', village: 1, guest: 2, gave: {}, got: {} },
  ];
  engine?.onEvents(evs, 1); log(`onEvents busy week (${evs.length} events, village 1 focused)`); refreshStatus();
};

// Time markers
const setTick = (t: number) => { tick = t; $('tick').textContent = String(t); engine?.tick(t); log(`tick ${t}`); refreshStatus(); };
$('tick-1').onclick = () => setTick(tick + 1);
$('tick-season').onclick = () => setTick(tick + 13 - (tick % 13));
$('tick-year').onclick = () => setTick(tick + 52 - (tick % 52));

// Spirit
$<HTMLInputElement>('pool').oninput = (e) => { $('pool-val').textContent = (Number((e.target as HTMLInputElement).value) / 100).toFixed(2); };
for (const k of ['message', 'sail', 'nudge', 'override', 'storm', 'dream-open', 'dream-close'] as SpiritKind[]) {
  const b = document.createElement('button'); b.textContent = k; b.dataset.spirit = k;
  b.onclick = () => { const pool = Number($<HTMLInputElement>('pool').value) / 100; engine?.spirit(k, pool); log(`spirit ${k} pool=${pool.toFixed(2)}`); refreshStatus(); };
  $('spirit').appendChild(b);
}

// Lifecycle
$('start').onclick = async () => {
  const seed = $<HTMLInputElement>('seed').value || 'wind';
  if (!engine || engine.snapshot().seed !== seed) build(seed);
  await engine.resume();
  log('resume()'); refreshStatus();
};
$('suspend').onclick = async () => { await engine?.suspend(); log('suspend()'); refreshStatus(); };
setInterval(refreshStatus, 1000);
