import { FISHING } from './config';
import type { FishDefinition } from './model';
export function fishingRecoverySpeed(tension: number, fish: FishDefinition, weightKg: number): number {
  const size = weightKg / fish.maxKg;
  return Math.max(0, (tension - FISHING.slackThreshold) / (1 - FISHING.slackThreshold)) * 2.4 / (.65 + fish.power * .7 + size * .6);
}
