/** Phoneme mixer: a few seeded syllable inventories produce pronounceable, distinct names. */
import type { Rng } from '@wind-spirit/sim';

const INVENTORIES = [
  { on: ['k', 'r', 't', 'n', 'm', 'v', 's', 'h', 'l', 'y'], nu: ['a', 'e', 'i', 'o', 'u', 'ai', 'au'], co: ['n', 'r', 'l', 'k', 's', ''] },
  { on: ['b', 'd', 'g', 'z', 'j', 'w', 'th', 'sh', 'f', ''], nu: ['a', 'o', 'u', 'e', 'ia', 'oa'], co: ['m', 'th', 'sh', 'd', ''] },
  { on: ['p', 't', 'k', 'ch', 'ts', 'q', 'x', 'n', ''], nu: ['a', 'i', 'e', 'ua', 'ei'], co: ['k', 't', 'ch', 'l', 'n', ''] },
  { on: ['m', 'n', 'ng', 'l', 'w', 'h', 'r', ''], nu: ['a', 'e', 'o', 'oo', 'ee', 'ae'], co: ['ng', 'n', 'l', 'r', ''] },
];

export function syllable(rng: Rng, inv = INVENTORIES[rng.int(INVENTORIES.length)]): string {
  return rng.pick(inv.on) + rng.pick(inv.nu) + (rng.chance(400) ? rng.pick(inv.co) : '');
}

export function name(rng: Rng, syllables = 2, tradition = -1): string {
  const inv = INVENTORIES[tradition >= 0 ? tradition % INVENTORIES.length : rng.int(INVENTORIES.length)];
  let s = ''; for (let i = 0; i < syllables; i++) s += syllable(rng, inv);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function villageNames(rng: Rng, n: number): string[] {
  const out = new Set<string>();
  while (out.size < n) out.add(name(rng, rng.range(2, 3), rng.int(INVENTORIES.length)));
  return [...out];
}
