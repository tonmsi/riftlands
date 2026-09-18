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

/** Analog movement uses cardinal sectors with hysteresis to avoid flickering at diagonals. */
export function playerSpriteDirectionRow(x: number, y: number, fallback: number, analog: boolean): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 1e-6) return fallback;
  if (!analog) return x !== 0 ? (x < 0 ? 2 : 3) : y < 0 ? 1 : 0;
  if (fallback < 2 && Math.abs(x) <= Math.abs(y) * 1.15) return y < 0 ? 1 : 0;
  if (fallback >= 2 && Math.abs(y) <= Math.abs(x) * 1.15) return x < 0 ? 2 : 3;
  return spriteDirectionRow(x, y, fallback);
}
