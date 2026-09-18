/**
 * Faces. A chief keeps one face for as long as they hold the position: it is chosen from the village and the
 * chief's own id, so it survives a reload and a replay, and changes only when a new chief is chosen. The two
 * spirits have faces of their own.
 */
const CHIEF_FACES = ['chief-a', 'chief-b', 'chief-c', 'chief-d', 'chief-e', 'chief-f', 'chief-g', 'chief-h'];

/** Stable pick: the same village and chief always get the same face. */
export function chiefFace(villageId: number, chiefId: number): string {
  let h = (villageId * 2654435761 + chiefId * 40503) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h = (h ^ (h >>> 13)) >>> 0;   // the final xor yields a signed int; without >>>0 the index goes negative
  return CHIEF_FACES[h % CHIEF_FACES.length];
}

export function Portrait({ face, size = 40, title, className = '' }: { face: string; size?: number; title?: string; className?: string }) {
  return <img className={`portrait ${className}`} src={`/art/portraits/${face}.png`} width={size} height={size} alt="" title={title} loading="lazy" />;
}

export const ChiefPortrait = ({ villageId, chiefId, size, title }: { villageId: number; chiefId: number; size?: number; title?: string }) =>
  <Portrait face={chiefFace(villageId, chiefId)} size={size} title={title} />;
