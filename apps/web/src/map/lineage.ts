/** One colour per founding village; colonies carry their parent's. Twelve hues, then it wraps. */
export const LINEAGE_COLOURS = ['#e0b43c', '#4f9bd8', '#d6533a', '#6fbf4a', '#b07ad6', '#3fbfb0', '#e8894a', '#c94f8c', '#8aa0b8', '#a5793a', '#5ac26f', '#7f8ee6'];
export const lineageColour = (lineage: number): string => LINEAGE_COLOURS[((lineage % LINEAGE_COLOURS.length) + LINEAGE_COLOURS.length) % LINEAGE_COLOURS.length];
