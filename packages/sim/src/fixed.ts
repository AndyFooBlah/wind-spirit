/** Fixed-point helpers. All sim quantities are integers in thousandths (K = 1000). */
export const K = 1000;
export const mul = (a: number, b: number): number => Math.trunc((a * b) / K);
export const div = (a: number, b: number): number => (b === 0 ? 0 : Math.trunc((a * K) / b));
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clampK = (v: number): number => clamp(v, 0, K);
/** Integer ceiling division. */
export const ceilDiv = (a: number, b: number): number => Math.trunc((a + b - 1) / b);
