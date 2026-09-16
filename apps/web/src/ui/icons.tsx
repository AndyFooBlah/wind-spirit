/**
 * Line glyphs for the goods categories and the skills, drawn by hand on a 24 grid rather than generated: they have to
 * stay crisp at sixteen pixels and take their colour from the surrounding text, which a painted sprite cannot do.
 * One stroke weight throughout, round caps and joins, no fills except where a shape needs to read as solid.
 */
import type { ReactNode } from 'react';

const P = (d: string) => <path d={d} />;

/** Goods categories, as `Category` in the sim. */
const GOODS: Record<string, ReactNode> = {
  grain: <>{P('M12 21V9')}{P('M12 9c0-2 1.5-3.5 3-4 .3 1.8-.6 3.4-3 4z')}{P('M12 9c0-2-1.5-3.5-3-4-.3 1.8.6 3.4 3 4z')}{P('M12 14c0-2 1.5-3.5 3-4 .3 1.8-.6 3.4-3 4z')}{P('M12 14c0-2-1.5-3.5-3-4-.3 1.8.6 3.4 3 4z')}</>,
  fruit: <>{P('M12 8a5 6 0 1 0 0 13 5 6 0 1 0 0-13z')}{P('M12 8V4')}{P('M12 6c2 0 3.5-1 4-3-2.2-.2-3.6.9-4 3z')}</>,
  root: <>{P('M12 9c2.5 0 4 2 4 5s-1.8 7-4 7-4-4-4-7 1.5-5 4-5z')}{P('M12 9V4')}{P('M12 6l3-2')}{P('M12 6L9 4')}</>,
  meat: <>{P('M9 13a5 5 0 1 1 7 4l-4 4-3-3z')}{P('M9 18l-4 3')}</>,
  fish: <>{P('M3 12c3-4 7-5 10-5s6 2 8 5c-2 3-5 5-8 5s-7-1-10-5z')}{P('M3 12l-1-4M3 12l-1 4')}{P('M17 11h.01')}</>,
  hide: <>{P('M8 4c-3 1-5 4-4 7l2 8c.3 1 1.2 1.5 2 1h8c.8.5 1.7 0 2-1l2-8c1-3-1-6-4-7-1.5 2-2.5 3-4 3s-2.5-1-4-3z')}</>,
  wood: <>{P('M4 8h12a4 4 0 0 1 0 8H4a4 4 0 0 1 0-8z')}{P('M4 8a4 4 0 0 0 0 8')}{P('M4 11a1 1 0 0 0 0 2')}</>,
  stone: <>{P('M5 15l3-8 7-2 4 6-3 6H7z')}{P('M8 7l3 5-4 3')}</>,
  fiber: <>{P('M7 4c4 3 4 13 0 16')}{P('M12 4c4 3 4 13 0 16')}{P('M17 4c4 3 4 13 0 16')}</>,
  herb: <>{P('M12 21V8')}{P('M12 12c-4 0-6-2-6-6 4 0 6 2 6 6z')}{P('M12 15c4 0 6-2 6-6-4 0-6 2-6 6z')}</>,
  clay: <>{P('M8 8h8l1 9a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3z')}{P('M7 8c0-2 2-3 5-3s5 1 5 3')}</>,
  salt: <>{P('M12 3l4 5-4 5-4-5z')}{P('M6 13l3 4-3 4-3-4z')}{P('M18 13l3 4-3 4-3-4z')}</>,
  ore: <>{P('M4 14l4-7 8-1 4 6-4 7H8z')}{P('M9 11h2M14 9h2M12 15h2')}</>,
  food: <>{P('M3 11h18c0 5-4 8-9 8s-9-3-9-8z')}{P('M8 8c0-2 1-3 1-4M12 8c0-2 1-3 1-4M16 8c0-2 1-3 1-4')}</>,
  drink: <>{P('M7 4h8l-1 12a3 3 0 0 1-3 3h0a3 3 0 0 1-3-3z')}{P('M15 7h2a2 2 0 0 1 0 5h-2')}{P('M8 21h6')}</>,
  cloth: <>{P('M4 6l8-2 8 2v12l-8 2-8-2z')}{P('M12 4v16')}{P('M4 10l8 2 8-2')}</>,
  instrument: <>{P('M4 14a4 4 0 1 0 8 0 4 4 0 1 0-8 0z')}{P('M12 14V5l8-2v9')}{P('M16 12a4 4 0 1 0 8 0')}</>,
  metal: <>{P('M3 15l3-5h12l3 5z')}{P('M6 10l2-3h8l2 3')}</>,
  fuel: <>{P('M6 16l4-6 5 2 3-3 2 7z')}{P('M9 13l2 3M15 12l1 4')}</>,
  curio: <>{P('M12 21V9')}{P('M12 9a4 4 0 1 1 4-4c0 3-3 3-3 1a1.5 1.5 0 1 1 3 0')}{P('M9 21h6')}</>,
};

/** Skills, as `Capability` in the sim. */
const CAPS: Record<string, ReactNode> = {
  fire: <>{P('M12 21c-4 0-6-3-6-6 0-4 4-5 3-9 4 2 5 5 5 7 1-1 1-2 1-4 2 2 3 4 3 6 0 3-2 6-6 6z')}</>,
  stonetools: <>{P('M4 9l6-4 5 3-3 6z')}{P('M12 14l-5 7')}</>,
  spear: <>{P('M6 20L18 5')}{P('M18 5l2-2-1 4-3 1z')}{P('M9 16l3 1')}</>,
  net: <>{P('M4 8h16M4 13h16M4 18h16')}{P('M8 5v16M13 5v16M18 5v16')}</>,
  paddle: <>{P('M12 21V11')}{P('M12 11c-3 0-4-2-4-4s2-4 4-4 4 2 4 4-1 4-4 4z')}</>,
  drying: <>{P('M4 6h16')}{P('M7 6v7M12 6v9M17 6v6')}{P('M5 19h14')}</>,
  pottery: <>{P('M8 9c-2 2-2 8 0 10h8c2-2 2-8 0-10z')}{P('M7 7c1-2 3-3 5-3s4 1 5 3z')}</>,
  weaving: <>{P('M4 4v16M20 4v16')}{P('M4 8h16M4 12h16M4 16h16')}{P('M8 4v16M16 4v16')}</>,
  cart: <>{P('M5 8h11l2 6H7z')}{P('M9 19a2 2 0 1 0 4 0 2 2 0 1 0-4 0z')}{P('M16 14l4 4')}</>,
  hull: <>{P('M3 13h18l-3 6H6z')}{P('M6 13V8l10 1v4')}</>,
  bow: <>{P('M7 3c6 3 6 15 0 18')}{P('M7 3l12 9L7 21')}{P('M19 12h3')}</>,
  medicine: <>{P('M8 10h8l-1 9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z')}{P('M6 10h12')}{P('M12 3v5M9 5l3 3 3-3')}</>,
  irrigation: <>{P('M3 16h18')}{P('M6 16V9M12 16V9M18 16V9')}{P('M6 6l1 2M12 5l1 2M18 6l1 2')}</>,
  husbandry: <>{P('M8 10a4 4 0 0 0 8 0')}{P('M8 10C5 10 4 7 4 5c3 0 4 2 4 5z')}{P('M16 10c3 0 4-3 4-5-3 0-4 2-4 5z')}{P('M9 14c1 3 5 3 6 0')}</>,
  sail: <>{P('M12 3v14')}{P('M12 5l7 10h-7z')}{P('M4 19h16')}</>,
  roadbuilding: <>{P('M8 21L10 4M16 21L14 4')}{P('M12 6v3M12 12v3M12 18v2')}</>,
  kiln: <>{P('M6 20V12a6 6 0 0 1 12 0v8z')}{P('M10 20v-4h4v4')}{P('M12 6V3')}</>,
  metaltools: <>{P('M5 19l8-8')}{P('M13 11l3-3a3 3 0 0 1 4 4l-3 3z')}{P('M4 20l2-2')}</>,
  hook: <>{P('M14 3v8a5 5 0 0 1-10 0')}{P('M14 3h-3M14 3l2 2')}</>,
  wagon: <>{P('M4 8h14l2 6H4z')}{P('M7 19a2 2 0 1 0 4 0 2 2 0 1 0-4 0z')}{P('M14 19a2 2 0 1 0 4 0 2 2 0 1 0-4 0z')}</>,
  seagoing: <>{P('M4 15h16l-2 4H6z')}{P('M12 3v12')}{P('M12 5l6 8h-6z')}{P('M3 21c2-1 3-1 5 0s3 1 5 0 3-1 5 0')}</>,
  bronzeweapons: <>{P('M12 3l3 10-3 6-3-6z')}{P('M7 13h10')}{P('M12 19v2')}</>,
  plough: <>{P('M4 6v8')}{P('M4 14h8l6 5H9z')}{P('M12 14l4-8')}{P('M20 21H7')}</>,
};

export const hasGoodsIcon = (name: string): boolean => name in GOODS;
export const hasCapIcon = (name: string): boolean => name in CAPS;

/** One glyph. `kind` picks the table; unknown names render nothing so new sim content never breaks a panel. */
export function Icon({ kind, name, size = 16, title }: { kind: 'goods' | 'cap'; name: string; size?: number; title?: string }) {
  const body = (kind === 'goods' ? GOODS : CAPS)[name];
  if (!body) return null;
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {body}
    </svg>
  );
}
