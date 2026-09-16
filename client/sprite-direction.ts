/**
 * Spritesheet rows: front/south, back/north, west, east.
 * Vertical rows own the ±45° sectors around north/south; the remaining
 * 90° sectors belong to west/east. A fallback keeps idle actors stable.
 */
export function spriteDirectionRow(x: number, y: number, fallback = 0): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 1e-6) return fallback;
  if (Math.abs(y) >= Math.abs(x)) return y < 0 ? 1 : 0;
  return x < 0 ? 2 : 3;
}
