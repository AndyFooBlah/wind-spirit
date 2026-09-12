/** Print site quality for villages: terrain around the home tile and food capacity. Usage: tsx src/sites.ts seed:village:lastYear ... */
import { generateWorld } from '@wind-spirit/gen';
import { neighbors } from '@wind-spirit/sim';
for (const spec of process.argv.slice(2).filter(a => a !== '--')) {
  const [seed, vid, last] = spec.split(':'); const w = generateWorld({ seed, villages: 4, startPop: 20 }); const v = w.villages[Number(vid)];
  const terr: Record<string, number> = {}; let plants = 0, game = 0, fish = 0;
  for (const t of neighbors(w, v.tile, 1, true)) { const tile = w.tiles[t]; terr[tile.terrain] = (terr[tile.terrain] ?? 0) + 1; plants += tile.cap.plants; game += tile.cap.game; fish += tile.cap.fish; }
  console.log(`${seed} v${vid} ${last === '99' ? 'alive' : 'died ' + last}  home=${w.tiles[v.tile].terrain}  cap plants ${plants / 1000} game ${game / 1000} fish ${fish / 1000}  ${JSON.stringify(terr)}`);
}
