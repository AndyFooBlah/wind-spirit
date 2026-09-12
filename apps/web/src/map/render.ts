/**
 * Canvas 2D map renderer with three zoom levels (world, local, village), placeholder art, a season tint that
 * crossfades, path and road lines, village marks, moving parties, storm swirls, and the village plot grid.
 */
import type { Terrain } from '@wind-spirit/sim';
import type { Frame, StaticMap, VillageDetail } from '../sim/protocol.ts';

export type Zoom = 'world' | 'local' | 'village';
export const LOCAL_TILE = 64;

export interface RenderState {
  map?: StaticMap; frame?: Frame; detail?: VillageDetail;
  zoom: Zoom; center: { x: number; y: number }; selected?: number;
  hoverTile?: number; targeting: boolean; speedMs: number; hoverPlot?: number;
}

const TERRAIN_COLOR: Record<Terrain, string> = {
  grass: '#8fae5a', forest: '#4f7a3a', hills: '#a8955c', mountain: '#8a8378', desert: '#d9c27a', oasis: '#6fb08a',
  marsh: '#6f8f5c', river: '#4f86b8', lake: '#3f79ad', coast: '#c9b984', ocean: '#2f5f8f',
};
const SEASON_TINT: [number, number, number, number][] = [[120, 210, 90, 0.10], [250, 205, 90, 0.12], [215, 135, 45, 0.20], [205, 225, 255, 0.32]];

function hexToRgb(h: string): [number, number, number] { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function mix(base: string, tint: [number, number, number, number]): string {
  const [r, g, b] = hexToRgb(base); const a = tint[3];
  return `rgb(${Math.round(r + (tint[0] - r) * a)},${Math.round(g + (tint[1] - g) * a)},${Math.round(b + (tint[2] - b) * a)})`;
}

interface Person { x: number; y: number; vx: number; vy: number; }

export class MapRenderer {
  private tint: [number, number, number, number] = [...SEASON_TINT[0]] as [number, number, number, number];
  private tintTarget = this.tint;
  private lastTime = 0;
  private colorCache = new Map<string, string>();
  private cacheKey = '';
  private partyPos = new Map<number, { x: number; y: number; fx: number; fy: number; t: number }>();
  private lastTick = -1;
  private people: Person[] = []; private peopleFor = -1;

  /** Tile size in CSS px and the top-left tile offset for the current zoom. */
  geometry(s: RenderState, W: number, H: number): { size: number; ox: number; oy: number } {
    const m = s.map; if (!m) return { size: 1, ox: 0, oy: 0 };
    if (s.zoom === 'world') { const size = Math.max(1, Math.floor(Math.min(W / m.width, H / m.height))); return { size, ox: (W - size * m.width) / 2, oy: (H - size * m.height) / 2 }; }
    const size = LOCAL_TILE; return { size, ox: W / 2 - s.center.x * size, oy: H / 2 - s.center.y * size };
  }
  tileAt(s: RenderState, W: number, H: number, px: number, py: number): number | undefined {
    const m = s.map; if (!m || s.zoom === 'village') return undefined;
    const g = this.geometry(s, W, H); const x = Math.floor((px - g.ox) / g.size), y = Math.floor((py - g.oy) / g.size);
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return undefined; return y * m.width + x;
  }
  plotGeometry(W: number, H: number): { size: number; ox: number; oy: number } { const size = Math.floor(Math.min(W, H) * 0.9 / 12); return { size, ox: (W - size * 12) / 2, oy: (H - size * 12) / 2 }; }
  plotAt(W: number, H: number, px: number, py: number): number | undefined {
    const g = this.plotGeometry(W, H); const x = Math.floor((px - g.ox) / g.size), y = Math.floor((py - g.oy) / g.size);
    if (x < 0 || y < 0 || x >= 12 || y >= 12) return undefined; return y * 12 + x;
  }

  draw(ctx: CanvasRenderingContext2D, s: RenderState, W: number, H: number, now: number): void {
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0; this.lastTime = now;
    ctx.fillStyle = '#1b2027'; ctx.fillRect(0, 0, W, H);
    const m = s.map, f = s.frame; if (!m || !f) return;
    this.tintTarget = SEASON_TINT[f.season];
    const k = Math.min(1, dt / 2 * 3);   // ~2 s crossfade
    this.tint = this.tint.map((v, i) => v + (this.tintTarget[i] - v) * k) as [number, number, number, number];
    const key = this.tint.map(v => v.toFixed(2)).join(',');
    if (key !== this.cacheKey) { this.cacheKey = key; this.colorCache.clear(); }
    if (s.zoom === 'village') { this.drawVillage(ctx, s, W, H, dt); return; }
    const g = this.geometry(s, W, H);
    const x0 = Math.max(0, Math.floor(-g.ox / g.size)), y0 = Math.max(0, Math.floor(-g.oy / g.size));
    const x1 = Math.min(m.width - 1, Math.ceil((W - g.ox) / g.size)), y1 = Math.min(m.height - 1, Math.ceil((H - g.oy) / g.size));
    const detailed = g.size >= 24;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const id = y * m.width + x; const t = m.terrain[id];
      ctx.fillStyle = this.color(t);
      const px = g.ox + x * g.size, py = g.oy + y * g.size;
      ctx.fillRect(px, py, g.size + (detailed ? 0 : 0.5), g.size + (detailed ? 0 : 0.5));
      if (detailed) this.decor(ctx, t, px, py, g.size, id, m.ford[id]);
    }
    this.drawPaths(ctx, m, f, g);
    this.drawParties(ctx, m, f, g, s, now);
    this.drawVillages(ctx, m, f, g, s, detailed);
    this.drawStorms(ctx, m, f, g, now);
    if (s.hoverTile !== undefined && (s.targeting || detailed)) {
      const hx = s.hoverTile % m.width, hy = Math.floor(s.hoverTile / m.width);
      ctx.strokeStyle = s.targeting ? '#ffd166' : 'rgba(255,255,255,0.5)'; ctx.lineWidth = s.targeting ? 3 : 1.5;
      ctx.strokeRect(g.ox + hx * g.size + 1, g.oy + hy * g.size + 1, g.size - 2, g.size - 2);
    }
  }

  /** Season tint per terrain; water takes a lighter tint so autumn ochre and winter blue do not muddy it. */
  private tintFor(t: Terrain): [number, number, number, number] { return t === 'ocean' || t === 'lake' || t === 'river' ? [this.tint[0], this.tint[1], this.tint[2], this.tint[3] * 0.35] : this.tint; }
  private color(t: Terrain): string { let c = this.colorCache.get(t); if (!c) { c = mix(TERRAIN_COLOR[t], this.tintFor(t)); this.colorCache.set(t, c); } return c; }
  private shade(t: Terrain, amount: number): string { const key = `${t}:${amount}`; let c = this.colorCache.get(key); if (!c) { const [r, g, b] = hexToRgb(TERRAIN_COLOR[t]); c = mix(`#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v * amount))).toString(16).padStart(2, '0')).join('')}`, this.tintFor(t)); this.colorCache.set(key, c); } return c; }

  private decor(ctx: CanvasRenderingContext2D, t: Terrain, px: number, py: number, size: number, id: number, ford: boolean): void {
    const r = (n: number) => ((id * 9301 + n * 49297) % 233280) / 233280;   // stable pseudo-random per tile
    ctx.save(); ctx.beginPath(); ctx.rect(px, py, size, size); ctx.clip();
    if (t === 'forest') { ctx.fillStyle = this.shade(t, 0.75); for (let i = 0; i < 6; i++) { const x = px + 6 + r(i) * (size - 12), y = py + 8 + r(i + 7) * (size - 14); ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4); ctx.closePath(); ctx.fill(); } }
    else if (t === 'grass') { ctx.strokeStyle = this.shade(t, 0.85); ctx.lineWidth = 1; for (let i = 0; i < 5; i++) { const x = px + 4 + r(i) * (size - 8), y = py + 6 + r(i + 3) * (size - 10); ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x + 1, y - 2); ctx.stroke(); } }
    else if (t === 'hills') { ctx.strokeStyle = this.shade(t, 0.78); ctx.lineWidth = 1.5; for (let i = 0; i < 3; i++) { const x = px + 8 + r(i) * (size - 16), y = py + 14 + r(i + 5) * (size - 18); ctx.beginPath(); ctx.arc(x, y, 7, Math.PI, 0); ctx.stroke(); } }
    else if (t === 'mountain') { ctx.fillStyle = this.shade(t, 0.7); for (let i = 0; i < 2; i++) { const x = px + 12 + r(i) * (size - 24), y = py + 16 + r(i + 4) * (size - 22); ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + 12, y + 8); ctx.lineTo(x - 12, y + 8); ctx.closePath(); ctx.fill(); ctx.fillStyle = mix('#f0f0f0', this.tint); ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + 4, y - 5); ctx.lineTo(x - 4, y - 5); ctx.closePath(); ctx.fill(); ctx.fillStyle = this.shade(t, 0.7); } }
    else if (t === 'desert') { ctx.fillStyle = this.shade(t, 0.88); for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(px + 4 + r(i) * (size - 8), py + 4 + r(i + 9) * (size - 8), 1.5, 0, Math.PI * 2); ctx.fill(); } }
    else if (t === 'oasis') { ctx.fillStyle = mix('#3f79ad', this.tint); ctx.beginPath(); ctx.ellipse(px + size / 2, py + size / 2, size * 0.22, size * 0.16, 0, 0, Math.PI * 2); ctx.fill(); }
    else if (t === 'marsh') { ctx.strokeStyle = mix('#4f86b8', this.tint); ctx.lineWidth = 1.5; for (let i = 0; i < 4; i++) { const x = px + 6 + r(i) * (size - 18), y = py + 8 + r(i + 2) * (size - 12); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 10, y); ctx.stroke(); } }
    else if (t === 'ocean' || t === 'lake') { ctx.strokeStyle = this.shade(t, 1.25); ctx.lineWidth = 1; for (let i = 0; i < 3; i++) { const x = px + 8 + r(i) * (size - 24), y = py + 10 + r(i + 6) * (size - 16); ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 4, y - 3, x + 8, y); ctx.quadraticCurveTo(x + 12, y + 3, x + 16, y); ctx.stroke(); } }
    else if (t === 'river') { ctx.strokeStyle = this.shade(t, 1.2); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px + size * 0.3, py); ctx.bezierCurveTo(px + size * 0.7, py + size * 0.3, px + size * 0.3, py + size * 0.7, px + size * 0.6, py + size); ctx.stroke(); if (ford) { ctx.fillStyle = mix('#d9c27a', this.tint); for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(px + size * 0.35 + i * 6, py + size * 0.5, 2, 0, Math.PI * 2); ctx.fill(); } } }
    else if (t === 'coast') { ctx.strokeStyle = mix('#efe4b8', this.tint); ctx.lineWidth = 1.5; for (let i = 0; i < 2; i++) { const x = px + 6 + r(i) * (size - 30), y = py + 12 + r(i + 4) * (size - 20); ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 6, y - 4, x + 12, y); ctx.quadraticCurveTo(x + 18, y + 4, x + 24, y); ctx.stroke(); } }
    ctx.restore();
  }

  private drawPaths(ctx: CanvasRenderingContext2D, m: StaticMap, f: Frame, g: { size: number; ox: number; oy: number }): void {
    const paths = new Set(f.paths), roads = new Set(f.roads); const all = new Set([...f.paths, ...f.roads]);
    if (!all.size) return;
    const c = (id: number) => [g.ox + (id % m.width + 0.5) * g.size, g.oy + (Math.floor(id / m.width) + 0.5) * g.size];
    const link = (set: Set<number>, width: number, color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.beginPath();
      for (const id of set) {
        const x = id % m.width, y = Math.floor(id / m.width); const [ax, ay] = c(id); let any = false;
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue; const nid = ny * m.width + nx; if (all.has(nid)) { const [bx, by] = c(nid); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); any = true; } }
        if (!any && g.size >= 4) { ctx.moveTo(ax - g.size * 0.2, ay); ctx.lineTo(ax + g.size * 0.2, ay); }
      }
      ctx.stroke();
    };
    link(paths, Math.max(1, g.size / 20), 'rgba(90,60,30,0.65)');
    link(roads, Math.max(2, g.size / 9), 'rgba(70,50,35,0.9)');
  }

  private drawVillages(ctx: CanvasRenderingContext2D, m: StaticMap, f: Frame, g: { size: number; ox: number; oy: number }, s: RenderState, detailed: boolean): void {
    for (const v of f.villages) {
      const x = g.ox + (v.tile % m.width + 0.5) * g.size, y = g.oy + (Math.floor(v.tile / m.width) + 0.5) * g.size;
      const r = Math.max(2, Math.min(g.size * 0.42, (2 + Math.sqrt(v.pop.total) * 1.6) * (g.size / LOCAL_TILE) * 1.8 + (detailed ? 4 : 1)));
      if (!v.alive) { ctx.strokeStyle = 'rgba(40,30,20,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); continue; }
      ctx.fillStyle = v.hungryWeek > 0 ? '#c9603a' : '#f1e3c2'; ctx.strokeStyle = '#3b2a1a'; ctx.lineWidth = Math.max(1, g.size / 32);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (s.selected === v.id) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke(); }
      if (detailed) { ctx.font = `600 13px "Alegreya Sans", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; const label = `${v.name} · ${v.pop.total}`; const w = ctx.measureText(label).width; ctx.fillStyle = 'rgba(20,20,20,0.6)'; ctx.fillRect(x - w / 2 - 4, y + r + 3, w + 8, 17); ctx.fillStyle = '#f7efe0'; ctx.fillText(label, x, y + r + 5); }
    }
  }

  private drawParties(ctx: CanvasRenderingContext2D, m: StaticMap, f: Frame, g: { size: number; ox: number; oy: number }, s: RenderState, now: number): void {
    if (f.tick !== this.lastTick) { this.lastTick = f.tick; for (const p of f.parties) { const cur = this.partyPos.get(p.id); const tx = p.at % m.width + 0.5, ty = Math.floor(p.at / m.width) + 0.5; if (!cur) this.partyPos.set(p.id, { x: tx, y: ty, fx: tx, fy: ty, t: now }); else if (cur.x !== tx || cur.y !== ty) { cur.fx = this.lerpX(cur, now, s.speedMs); cur.fy = this.lerpY(cur, now, s.speedMs); cur.x = tx; cur.y = ty; cur.t = now; } } const ids = new Set(f.parties.map(p => p.id)); for (const id of [...this.partyPos.keys()]) if (!ids.has(id)) this.partyPos.delete(id); }
    for (const p of f.parties) {
      const pos = this.partyPos.get(p.id); if (!pos) continue;
      const x = g.ox + this.lerpX(pos, now, s.speedMs) * g.size, y = g.oy + this.lerpY(pos, now, s.speedMs) * g.size;
      const r = Math.max(2.5, g.size / 10);
      ctx.lineWidth = 1; ctx.strokeStyle = '#1d1a14';
      if (p.boat) { ctx.fillStyle = '#e9d8a6'; ctx.beginPath(); ctx.moveTo(x - r * 1.6, y - r * 0.3); ctx.lineTo(x + r * 1.6, y - r * 0.3); ctx.lineTo(x + r * 0.9, y + r * 0.8); ctx.lineTo(x - r * 0.9, y + r * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y - r * 0.3); ctx.lineTo(x, y - r * 1.6); ctx.stroke(); }
      else if (p.kind === 'raid') { ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(x, y - r * 1.4); ctx.lineTo(x + r * 1.3, y + r); ctx.lineTo(x - r * 1.3, y + r); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      else { ctx.fillStyle = p.kind === 'envoy' ? '#7fb3d5' : p.kind === 'colonize' ? '#e0b070' : p.kind === 'refugee' ? '#b0a090' : '#f4f1de'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
  }
  private lerpX(p: { x: number; fx: number; t: number }, now: number, ms: number): number { const k = ms > 0 ? Math.min(1, (now - p.t) / Math.min(ms, 1000)) : 1; return p.fx + (p.x - p.fx) * k; }
  private lerpY(p: { y: number; fy: number; t: number }, now: number, ms: number): number { const k = ms > 0 ? Math.min(1, (now - p.t) / Math.min(ms, 1000)) : 1; return p.fy + (p.y - p.fy) * k; }

  private drawStorms(ctx: CanvasRenderingContext2D, m: StaticMap, f: Frame, g: { size: number; ox: number; oy: number }, now: number): void {
    for (const st of f.storms) {
      const x = g.ox + (st.tile % m.width + 0.5) * g.size, y = g.oy + (Math.floor(st.tile / m.width) + 0.5) * g.size; const R = Math.max(4, g.size * 0.45);
      ctx.strokeStyle = 'rgba(240,240,255,0.85)'; ctx.lineWidth = Math.max(1, g.size / 24); ctx.beginPath();
      const rot = (now / 400) % (Math.PI * 2);
      for (let a = 0; a < Math.PI * 4; a += 0.2) { const rr = R * a / (Math.PI * 4); const px = x + Math.cos(a + rot) * rr, py = y + Math.sin(a + rot) * rr; if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.stroke();
    }
  }

  private drawVillage(ctx: CanvasRenderingContext2D, s: RenderState, W: number, H: number, dt: number): void {
    const d = s.detail; const m = s.map!; const f = s.frame!;
    const g = this.plotGeometry(W, H);
    const v = f.villages.find(x => x.id === s.selected);
    const terrain: Terrain = v ? m.terrain[v.tile] : 'grass';
    ctx.fillStyle = this.color(terrain); ctx.fillRect(g.ox - 20, g.oy - 20, g.size * 12 + 40, g.size * 12 + 40);
    if (!d || d.id !== s.selected) { ctx.fillStyle = '#f7efe0'; ctx.font = '16px "Alegreya Sans"'; ctx.textAlign = 'center'; ctx.fillText('Select a village to see its plots', W / 2, H / 2); return; }
    for (let i = 0; i < 144; i++) {
      const p = d.plots[i]; const x = g.ox + (i % 12) * g.size, y = g.oy + Math.floor(i / 12) * g.size;
      if (p.kind === 'wild') { ctx.fillStyle = this.color(terrain); ctx.fillRect(x, y, g.size, g.size); this.decor(ctx, terrain, x, y, g.size, i * 7 + d.id, false); }
      else if (p.kind === 'clear') { ctx.fillStyle = mix('#b59a6a', this.tint); ctx.fillRect(x, y, g.size, g.size); }
      else if (p.kind === 'field') {
        ctx.fillStyle = mix('#a8804d', this.tint); ctx.fillRect(x, y, g.size, g.size);
        ctx.strokeStyle = p.planted ? mix('#5f9b3a', this.tint) : mix('#8e6b40', this.tint); ctx.lineWidth = Math.max(2, g.size / 8);
        for (let k = 0; k < 4; k++) { const yy = y + g.size * (k + 0.5) / 4; ctx.beginPath(); ctx.moveTo(x + 3, yy); ctx.lineTo(x + g.size - 3, yy); ctx.stroke(); }
      } else {
        ctx.fillStyle = this.color(terrain); ctx.fillRect(x, y, g.size, g.size);
        const pad = g.size * 0.18; const bw = g.size - pad * 2, bh = g.size * 0.45;
        ctx.fillStyle = p.recipe === 'tent' || p.recipe.startsWith('tent') ? '#d8c8a8' : '#8c6d4a'; ctx.fillRect(x + pad, y + g.size * 0.42, bw, bh);
        ctx.fillStyle = '#5a3d28'; ctx.beginPath(); ctx.moveTo(x + pad - 3, y + g.size * 0.42); ctx.lineTo(x + g.size / 2, y + g.size * 0.15); ctx.lineTo(x + g.size - pad + 3, y + g.size * 0.42); ctx.closePath(); ctx.fill();
      }
      if (p.building) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; ctx.strokeRect(x + 3, y + 3, g.size - 6, g.size - 6); ctx.setLineDash([]); }
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, g.size - 1, g.size - 1);
      if (s.hoverPlot === i) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.strokeRect(x + 1.5, y + 1.5, g.size - 3, g.size - 3); }
    }
    // people wander
    const n = d.view.people.total;
    if (this.peopleFor !== d.id) { this.people = []; this.peopleFor = d.id; }
    while (this.people.length < n) this.people.push({ x: Math.random() * 12, y: Math.random() * 12, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6 });
    if (this.people.length > n) this.people.length = n;
    ctx.fillStyle = '#2b1d12';
    for (const p of this.people) {
      if (Math.random() < 0.02) { p.vx = (Math.random() - 0.5) * 0.6; p.vy = (Math.random() - 0.5) * 0.6; }
      p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 0.1 || p.x > 11.9) p.vx *= -1; if (p.y < 0.1 || p.y > 11.9) p.vy *= -1; p.x = Math.max(0.1, Math.min(11.9, p.x)); p.y = Math.max(0.1, Math.min(11.9, p.y));
      ctx.beginPath(); ctx.arc(g.ox + p.x * g.size, g.oy + p.y * g.size, Math.max(1.5, g.size / 14), 0, Math.PI * 2); ctx.fill();
    }
  }
}
