import { FISHING } from './config';

/** Amplified remaining line; display scaling never changes the landing threshold. */
export function formatFishingDistance(distanceM: number | undefined): string {
  if (distanceM === undefined || !Number.isFinite(distanceM)) return '—';
  const remaining = Math.max(0, distanceM - FISHING.catchDistanceM);
  // Never show zero before the authoritative landing threshold is reached.
  const hundredths = remaining > 0 ? Math.max(1, Math.round(remaining * FISHING.distanceDisplayMultiplier * 100)) : 0;
  return (hundredths / 100).toFixed(2).replace('.', ',');
}
