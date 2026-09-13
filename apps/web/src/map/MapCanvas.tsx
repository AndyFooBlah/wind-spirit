import { useEffect, useRef, useState } from 'react';
import type { PlotView, PersonView, PartySummary, Frame } from '../sim/protocol.ts';
import { useGame, selectVillage, setCenter, setZoom, stormAt, tickLabel, viewDetail, viewFrame, type Zoom } from '../store/game.ts';
import { SPEED_MS } from '../sim/protocol.ts';
import { MapRenderer, LOCAL_TILE, type RenderState } from './render.ts';

function HistoryBanner() {
  const h = useGame(s => s.history); if (!h) return null;
  return <div className="banner history">{h.loading ? 'Remembering…' : `${tickLabel(h.tick)} — history`}</div>;
}

/** One canvas, three zoom levels. Drag or arrow keys pan the local view; click selects; double-click zooms in. */
export function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef(new MapRenderer());
  const state = useRef<RenderState>({ zoom: 'local', center: { x: 32, y: 32 }, targeting: false, speedMs: 0 });
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | undefined>();
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | undefined>();
  const zoom = useGame(s => s.zoom); const targeting = useGame(s => s.targeting);

  useEffect(() => {
    const sync = () => { const s = useGame.getState(); Object.assign(state.current, { map: s.map, frame: viewFrame(s), detail: viewDetail(s), zoom: s.zoom, center: s.center, selected: s.selected, targeting: s.targeting, speedMs: SPEED_MS[s.speed] }); };
    sync(); const unsub = useGame.subscribe(sync);
    const canvas = canvasRef.current!; const ctx = canvas.getContext('2d')!;
    let raf = 0; let W = 0, H = 0;
    const resize = () => { const r = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; W = r.width; H = r.height; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
    const loop = (now: number) => { renderer.current.draw(ctx, state.current, W, H, now); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const keys = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const s = useGame.getState(); if (s.zoom !== 'local') return;
      const d = e.shiftKey ? 4 : 1; let { x, y } = s.center;
      if (e.key === 'ArrowLeft') x -= d; else if (e.key === 'ArrowRight') x += d; else if (e.key === 'ArrowUp') y -= d; else if (e.key === 'ArrowDown') y += d; else return;
      e.preventDefault(); const m = s.map; if (m) setCenter(Math.max(0, Math.min(m.width, x)), Math.max(0, Math.min(m.height, y)));
    };
    window.addEventListener('keydown', keys);
    return () => { unsub(); ro.disconnect(); cancelAnimationFrame(raf); window.removeEventListener('keydown', keys); };
  }, []);

  const size = () => { const r = canvasRef.current!.getBoundingClientRect(); return [r.width, r.height, r.left, r.top] as const; };

  const onDown = (e: React.MouseEvent) => { const s = useGame.getState(); drag.current = { x: e.clientX, y: e.clientY, cx: s.center.x, cy: s.center.y, moved: false }; };
  const onMove = (e: React.MouseEvent) => {
    const [W, H, L, T] = size(); const px = e.clientX - L, py = e.clientY - T; const s = useGame.getState();
    if (drag.current && s.zoom === 'local') {
      const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
      if (drag.current.moved) setCenter(drag.current.cx - dx / LOCAL_TILE, drag.current.cy - dy / LOCAL_TILE);
      return;
    }
    if (s.zoom === 'village') {
      const d = viewDetail(s);
      // A villager under the pointer wins over the plot they stand on.
      const who = renderer.current.personAt(W, H, px, py); state.current.hoverPerson = who;
      const person = who !== undefined && d ? d.people.find(x => x.id === who) : undefined;
      if (person) { state.current.hoverPlot = undefined; setTip({ x: px + 14, y: py + 14, text: personText(person) }); return; }
      const p = renderer.current.plotAt(W, H, px, py); state.current.hoverPlot = p;
      const plot = p !== undefined && d ? d.plots[p] : undefined;
      const terrain = s.map && d ? s.map.terrain[viewFrame(s)?.villages.find(x => x.id === d.id)?.tile ?? 0] : 'grass';
      if (plot) setTip({ x: px + 14, y: py + 14, text: plotText(plot, terrain, d?.people.filter(x => x.plot === p) ?? []) }); else setTip(undefined);
      return;
    }
    const t = renderer.current.tileAt(state.current, W, H, px, py); state.current.hoverTile = t;
    const fr = viewFrame(s);
    if (t !== undefined && s.map && fr) {
      const v = fr.villages.find(x => x.tile === t && x.alive); const extra = s.map.extra[t].map(id => s.map!.names.commodities[id] ?? id);
      const parts = [s.map.terrain[t], ...(v ? [`${v.name}, ${v.pop.total} people`] : []), ...(extra.length ? [`here: ${extra.join(', ')}`] : []), ...(fr.roads.includes(t) ? ['road'] : fr.paths.includes(t) ? ['path'] : [])];
      for (const p of fr.parties.filter(p => p.at === t)) parts.push(partyText(p, fr));
      setTip({ x: px + 14, y: py + 14, text: parts.join(' · ') });
    } else setTip(undefined);
  };
  const onUp = (e: React.MouseEvent) => {
    const d = drag.current; drag.current = undefined; if (!d || d.moved) return;
    const [W, H, L, T] = size(); const s = useGame.getState();
    if (s.zoom === 'village') return;
    const t = renderer.current.tileAt(state.current, W, H, e.clientX - L, e.clientY - T); if (t === undefined) return;
    if (s.targeting && !s.history) { stormAt(t); return; }
    const v = viewFrame(s)?.villages.find(x => x.tile === t); if (v) selectVillage(v.id);
  };
  const onDouble = (e: React.MouseEvent) => {
    const [W, H, L, T] = size(); const s = useGame.getState(); if (s.targeting) return;
    if (s.zoom === 'world') { const t = renderer.current.tileAt(state.current, W, H, e.clientX - L, e.clientY - T); if (t !== undefined && s.map) { setCenter(t % s.map.width + 0.5, Math.floor(t / s.map.width) + 0.5); setZoom('local'); } }
    else if (s.zoom === 'local') { const t = renderer.current.tileAt(state.current, W, H, e.clientX - L, e.clientY - T); const v = viewFrame(s)?.villages.find(x => x.tile === t && x.alive); if (v) { selectVillage(v.id); setZoom('village'); } }
  };
  const onWheel = (e: React.WheelEvent) => {
    const s = useGame.getState(); const order: Zoom[] = ['world', 'local', 'village']; const i = order.indexOf(s.zoom);
    if (e.deltaY > 0 && i > 0) setZoom(order[i - 1]);
    else if (e.deltaY < 0 && i < 2) { if (order[i + 1] === 'village' && s.selected === undefined) return; setZoom(order[i + 1]); }
  };
  const onLeave = () => { drag.current = undefined; state.current.hoverTile = undefined; state.current.hoverPlot = undefined; state.current.hoverPerson = undefined; setTip(undefined); };

  return (
    <div className={`map ${targeting ? 'targeting' : ''} zoom-${zoom}`}>
      <canvas ref={canvasRef} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onLeave} onDoubleClick={onDouble} onWheel={onWheel} />
      {tip && <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
      {targeting && <div className="banner">Choose a tile for the storm (Esc to cancel)</div>}
      <HistoryBanner />
    </div>
  );
}

const SOIL = (f: number) => (f >= 0.9 ? 'strong soil' : f >= 0.6 ? 'tired soil' : 'worn-out soil');
const TERRAIN_WORD: Record<string, string> = { grass: 'open grassland', forest: 'woodland', hills: 'rough hillside', mountain: 'bare rock', desert: 'sand and scrub', oasis: 'green ground by the water', marsh: 'reeds and wet ground', river: 'the riverbank', lake: 'the lakeshore', coast: 'the shore', ocean: 'open water' };

/** Every plot describes itself, wild ground included. */
function plotText(plot: PlotView, terrain: string, folk: PersonView[]): string {
  const who = folk.length ? ` · ${folk.length === 1 ? folk[0].name : `${folk.length} people`} here` : '';
  if (plot.kind === 'structure') {
    const st = plot.structure; const uses: string[] = [];
    if (st) { if (st.shelter > 0) uses.push(`shelters ${st.shelter}`); if (st.storage > 0 && st.shelter === 0) uses.push('keeps stores'); if ((st.defense ?? 0) > 0) uses.push('defends'); if (st.watch) uses.push('watches the land'); }
    return `${plot.recipe}${uses.length ? ` (${uses.join(', ')})` : ''}${who}`;
  }
  if (plot.building) return `building ${plot.recipe}, ${Math.round(plot.progress * 100)}% done${who}`;
  if (plot.kind === 'field') return `${plot.planted ? `field of ${plot.crop || 'grain'}` : 'field resting fallow'}, ${SOIL(plot.fertility)}${who}`;
  if (plot.kind === 'clear') return `cleared ground, ${SOIL(plot.fertility)}, ready to plant or build on${who}`;
  return `wild ${TERRAIN_WORD[terrain] ?? terrain}${who}`;
}
function personText(p: PersonView): string {
  const stage = p.stage === 'child' ? 'child' : p.stage === 'elder' ? 'elder' : 'adult';
  return `${p.name}${p.chief ? ', the chief' : ''} · ${stage}, ${p.age} · ${p.doing}${p.out ? ' (away from the village this week)' : ''}`;
}
const KIND_WORD: Record<string, string> = { explore: 'explorers', colonize: 'settlers', refugee: 'refugees', envoy: 'envoys', raid: 'raiders', expedition: 'an expedition' };
function partyText(p: PartySummary, fr: Frame): string {
  const home = fr.villages.find(v => v.id === p.home)?.name ?? 'nowhere'; const dest = p.targetVillage !== undefined ? fr.villages.find(v => v.id === p.targetVillage)?.name : undefined;
  const what = p.kind === 'envoy' ? (p.errand === 'threat' ? 'envoys with a demand' : p.errand === 'gift' ? 'envoys bearing gifts' : 'envoys to trade') : p.kind === 'expedition' && p.gathering ? `an expedition after ${p.gathering}` : KIND_WORD[p.kind] ?? p.kind;
  const where = p.waiting > 0 ? 'waiting' : p.returning ? `heading home, ${p.left} tiles to go` : dest ? `bound for ${dest}, ${p.left} tiles to go` : p.left > 0 ? `${p.left} tiles to go` : 'arrived';
  return `${what} from ${home}, ${p.size} people${p.boat ? ' by boat' : ''}${p.cargo ? `, carrying ${p.cargo}` : ''}, ${where}`;
}
