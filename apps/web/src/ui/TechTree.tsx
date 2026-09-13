import { useMemo, useState } from 'react';
import type { TechNode } from '../sim/protocol.ts';
import { useGame, viewDetail, viewFrame } from '../store/game.ts';

/**
 * The world's recipe tree by tier, with the open village laid over it: held recipes solid, hinted ones dashed,
 * the rest faded. The spirit sees the whole tree; the chiefs see only what they hold or have heard.
 */
export function TechTree({ onClose }: { onClose: () => void }) {
  const map = useGame(s => s.map); const detail = useGame(viewDetail); const frame = useGame(viewFrame);
  const [hover, setHover] = useState<string>();
  const village = detail && frame ? frame.villages.find(v => v.id === detail.id) : undefined;
  const layout = useMemo(() => (map ? place(map.tech) : undefined), [map]);
  if (!map || !layout) return null;
  const held = new Set(detail?.tech.held ?? []); const hints = detail?.tech.hints ?? {}; const caps = new Set(detail?.tech.capabilities ?? []);
  const state = (n: TechNode): 'held' | 'hinted' | 'unknown' => (held.has(n.id) ? 'held' : (hints[n.id] ?? 0) > 0 ? 'hinted' : 'unknown');
  const hot = hover ? layout.nodes.find(n => n.node.id === hover) : undefined;
  const related = new Set<string>(); if (hot) { for (const e of layout.edges) { if (e.from === hot.node.id) related.add(e.to); if (e.to === hot.node.id) related.add(e.from); } }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal tech" onClick={e => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><span className="strong">The tree of recipes</span> <span className="small muted">{map.tech.length} recipes in this world{village ? `, laid over ${village.name}: ${held.size} held, ${Object.values(hints).filter(h => h > 0).length - [...held].filter(h => (hints[h] ?? 0) > 0).length} heard of` : ' (open a village to see what it holds)'}</span></div>
          <div className="row small"><span><span className="key held" /> held</span><span><span className="key hinted" /> hinted</span><span><span className="key unknown" /> unknown</span><button className="ghost" onClick={onClose}>Close</button></div>
        </div>
        <div className="tree-scroll">
          <svg width={layout.width} height={layout.height} role="img" aria-label="tech tree">
            {layout.tiers.map(t => <text key={t.tier} x={t.x + NODE_W / 2} y={14} fontSize={12} fontWeight={600} textAnchor="middle" fill="#5a4a30">tier {t.tier}</text>)}
            {layout.edges.map((e, i) => {
              const a = layout.at.get(e.from)!, b = layout.at.get(e.to)!; const lit = hot && (e.from === hot.node.id || e.to === hot.node.id);
              const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2; const mx = (x1 + x2) / 2;
              return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={lit ? '#b3261e' : e.kind === 'requires' ? '#6a4c93' : '#8a7a60'} strokeWidth={lit ? 2 : 1} opacity={hot && !lit ? 0.15 : 0.7} strokeDasharray={e.kind === 'requires' ? '4 3' : undefined} />;
            })}
            {layout.nodes.map(({ node: n, x, y }) => {
              const st = state(n); const dim = hot && hot.node.id !== n.id && !related.has(n.id);
              return (
                <g key={n.id} transform={`translate(${x},${y})`} className={`node ${st}`} opacity={dim ? 0.3 : 1} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(undefined)}>
                  <rect width={NODE_W} height={NODE_H} rx={6} />
                  <text x={8} y={16} fontSize={12} fontWeight={600}>{n.name}</text>
                  <text x={8} y={31} fontSize={10} fill="#5a4a30">{n.makes.length > 34 ? n.makes.slice(0, 33) + '…' : n.makes}</text>
                  {n.makesKind === 'capability' && n.makesId && caps.has(n.makesId) && <circle cx={NODE_W - 9} cy={9} r={4} fill="#4c9a2a" />}
                </g>
              );
            })}
          </svg>
        </div>
        {hot && (
          <div className="small tech-detail">
            <span className="strong">{hot.node.name}</span> (tier {hot.node.tier}{hot.node.start ? ', known from the start' : ''}): {hot.node.inputs.map(i => `${i.qty} ${i.name}`).join(' + ') || 'no inputs'}{hot.node.requires ? `, needs the skill ${map.names.capabilities[hot.node.requires] ?? hot.node.requires}` : ''} → {hot.node.makes}.
            {village ? ` ${village.name}: ${state(hot.node) === 'held' ? 'holds this' : state(hot.node) === 'hinted' ? `has heard ${hints[hot.node.id]} of ${hot.node.hints} hints` : 'knows nothing of it'}.` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

const NODE_W = 190, NODE_H = 38, COL_GAP = 60, ROW_GAP = 10, TOP = 24;

/** Columns by tier; within a column, recipes sorted so that ones fed by the previous column sit near their sources. Edges: an output that is another recipe's input, or a skill another recipe requires. */
function place(tech: TechNode[]) {
  const tiers = [...new Set(tech.map(t => t.tier))].sort((a, b) => a - b);
  const byOut = new Map<string, string[]>(); for (const t of tech) if (t.makesId) byOut.set(t.makesId, [...(byOut.get(t.makesId) ?? []), t.id]);
  const edges: { from: string; to: string; kind: 'input' | 'requires' }[] = [];
  for (const t of tech) {
    for (const i of t.inputs) for (const src of byOut.get(i.id) ?? []) if (src !== t.id) edges.push({ from: src, to: t.id, kind: 'input' });
    if (t.requires) for (const src of byOut.get(t.requires) ?? []) if (src !== t.id) edges.push({ from: src, to: t.id, kind: 'requires' });
  }
  const at = new Map<string, { x: number; y: number }>(); const nodes: { node: TechNode; x: number; y: number }[] = []; const cols: { tier: number; x: number }[] = [];
  let maxRows = 0;
  tiers.forEach((tier, ci) => {
    const x = 12 + ci * (NODE_W + COL_GAP); cols.push({ tier, x });
    const inCol = tech.filter(t => t.tier === tier);
    // order by the mean row of sources already placed, so edges cross less
    const key = (t: TechNode) => { const src = edges.filter(e => e.to === t.id).map(e => at.get(e.from)?.y).filter((y): y is number => y !== undefined); return src.length ? src.reduce((a, b) => a + b, 0) / src.length : 1e9; };
    inCol.sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name));
    inCol.forEach((t, ri) => { const y = TOP + ri * (NODE_H + ROW_GAP); at.set(t.id, { x, y }); nodes.push({ node: t, x, y }); });
    maxRows = Math.max(maxRows, inCol.length);
  });
  return { nodes, edges, at, tiers: cols, width: 24 + tiers.length * (NODE_W + COL_GAP) - COL_GAP, height: TOP + maxRows * (NODE_H + ROW_GAP) + 8 };
}
