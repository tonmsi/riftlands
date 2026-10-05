import type { NarrativeCondition } from './narrative';
export interface LootRule { itemId: string; quantity: number; chance: number; condition?: NarrativeCondition; }
// Independent rolls, chance in [0, 1]. Currency is collected without occupying inventory slots.
const COMMON_LOOT: readonly LootRule[] = [
  { itemId: 'gold', quantity: 10, chance: 1 },
  { itemId: 'healing-potion', quantity: 1, chance: .10 },
];
export const NPC_LOOT_TABLES: Readonly<Record<string, readonly LootRule[]>> = {
  slime: [{ itemId: 'slime-innards', quantity: 1, chance: .5, condition: { kind: 'quest-status', questId: 'stinking-bait', status: 'active' } }, ...COMMON_LOOT],
  wisp: COMMON_LOOT,
  sentinel: COMMON_LOOT,
};
