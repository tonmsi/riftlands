import type { Vec2 } from '../types';
export type FishingPhase = 'ready' | 'waiting' | 'bite' | 'fight' | 'result';
export type BaitKind = 'shiny' | 'organic' | 'odd';
export type FishRarity = 'common' | 'uncommon' | 'rare';
export const RARITIES: Record<FishRarity, { label: string; color: string }> = { common: { label: 'Comune', color: '#b9d6be' }, uncommon: { label: 'Non comune', color: '#83cacf' }, rare: { label: 'Raro', color: '#bb9fe5' } };
export interface FishDefinition { id: string; name: string; minKg: number; maxKg: number; power: number; speed: number; rarity: FishRarity; spawnWeight: number; attraction: Record<BaitKind, number>; }
export const FISH: readonly FishDefinition[] = [
  { id: 'fish-pike', name: 'Luccio argentato', minKg: .8, maxKg: 2.8, power: .85, speed: 1.2, rarity: 'uncommon', spawnWeight: 1, attraction: { shiny: 8, organic: 1, odd: 1 } },
  { id: 'fish-catfish', name: 'Siluro di fondale', minKg: 3, maxKg: 8, power: 1.15, speed: .65, rarity: 'rare', spawnWeight: .4, attraction: { shiny: 1, organic: 8, odd: 2 } },
  { id: 'fish-perch', name: 'Persico di riva', minKg: .2, maxKg: .8, power: .55, speed: 1, rarity: 'common', spawnWeight: 2, attraction: { shiny: 2, organic: 2, odd: 7 } },
];
export { FISHING } from './config';
export interface FishingView {
  id: string; phase: FishingPhase; baitId?: string; baitSlot?: number; bobber?: Vec2; castAt?: number;
  biteUntil?: number; fishId?: string; weightKg?: number; tension: number; progress: number;
  danger: number; reeling: boolean; message: string; outcome?: 'caught' | 'broken' | 'missed' | 'withdrawn' | 'escaped';
  distanceM?: number; initialDistanceM?: number; slackDanger?: number; catchId?: string; catchAt?: number; rarity?: FishRarity; catchOnGround?: boolean;
  noBite?: boolean; baitUsesRemaining?: number; resultId?: string;
}
export type FishingCommand = { kind: 'open' } | { kind: 'close'; sessionId: string }
  | { kind: 'bait'; sessionId: string; itemId: string; slot?: number }
  | { kind: 'cast'; sessionId: string; x: number; y: number }
  | { kind: 'reel'; sessionId: string; held: boolean };
export function validFishingCommand(value: unknown): value is FishingCommand {
  const c = value as FishingCommand; if (!c || typeof c !== 'object') return false;
  if (c.kind === 'open') return true;
  if (!('sessionId' in c) || typeof c.sessionId !== 'string' || !c.sessionId.length || c.sessionId.length > 80) return false;
  if (c.kind === 'close') return true;
  if (c.kind === 'reel') return typeof c.held === 'boolean';
  if (c.kind === 'cast') return [c.x, c.y].every(n => Number.isFinite(n) && Math.abs(n) < 1e7);
  return c.kind === 'bait' && typeof c.itemId === 'string' && c.itemId.length > 0 && c.itemId.length <= 128 && (c.slot === undefined || Number.isSafeInteger(c.slot) && c.slot >= 0 && c.slot < 5);
}
