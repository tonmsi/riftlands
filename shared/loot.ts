import type { NarrativeCondition } from './narrative';
export interface LootRule { itemId: string; quantity: number; chance: number; condition?: NarrativeCondition; }
export const NPC_LOOT_TABLES: Readonly<Record<string, readonly LootRule[]>> = {
  slime: [{ itemId: 'slime-innards', quantity: 1, chance: .5, condition: { kind: 'quest-status', questId: 'stinking-bait', status: 'active' } }],
};
