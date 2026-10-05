/** Percentages are fractions: .78 = 78%. Tune fishing here without changing the UI. */
export const FISHING = {
  minCast: 40, maxCast: 260, shoreRange: 260, unitsPerMeter: 24,
  biteChance: .78, waitMinMs: 2500, waitMaxMs: 6000, emptyWaitMs: 7500,
  biteWindowMs: 1500, breakThreshold: .99, breakMs: 850,
  slackThreshold: .55, slackMs: 2200, reelLeaseMs: 900,
  catchDistanceM: 1.5, catchDropTtlMs: 45000,
  distanceDisplayMultiplier: 5,
};
