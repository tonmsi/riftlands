import { CLASSES, levelFromXp, MAX_LEVEL, xpForLevel } from './config';
import type { AbilityDef, AbilitySlot, Actor, ClassId } from './types';
import { newInventory, type Inventory } from './items';
import { newNarrativeProgress, type NarrativeProgress } from './narrative';

export type SpellId = 'q' | 'e' | 'r';
export interface Loadout { q: SpellId | null; e: SpellId | null; }
export interface CharacterProgress {
  xp: number;
  loadout: Loadout;
  configuredTier: number;
  inventory: Inventory;
  narrative: NarrativeProgress;
}
export interface CharacterSummary { xp: number; loadout: Loadout; freeBuild: boolean; }
export const BUILD_COST = 10;
export const DEVELOPER_LEVEL = MAX_LEVEL;
export const DEVELOPER_XP = xpForLevel(MAX_LEVEL - 1);
export function unlockTier(level: number): number { return level >= 10 ? 3 : level >= 6 ? 2 : level >= 3 ? 1 : 0; }
export function availableSpells(level: number): SpellId[] { return level >= 10 ? ['q', 'e', 'r'] : level >= 6 ? ['q', 'e'] : level >= 3 ? ['q'] : []; }
export function normalizeLoadout(value: Loadout | undefined, level: number, classId: ClassId): Loadout {
  const available = availableSpells(level);
  const q = level < 3 ? null : value?.q && available.includes(value.q) ? value.q : 'q';
  const e = level < 6 ? null : value?.e && value.e !== q && available.includes(value.e) ? value.e : available.find(id => id !== q)!;
  return { q, e };
}
export function newCharacter(classId: ClassId): CharacterProgress {
  const xp = classId === 'hunter' ? DEVELOPER_XP : 0;
  return { xp, loadout: normalizeLoadout(undefined, levelFromXp(xp), classId), configuredTier: 0, inventory: newInventory(), narrative: newNarrativeProgress() };
}
export function validLoadout(value: unknown, level: number, classId: ClassId): value is Loadout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Loadout;
  return (level < 3 ? v.q === null : !!v.q && availableSpells(level).includes(v.q)) && (level < 6 ? v.e === null : !!v.e && v.e !== v.q && availableSpells(level).includes(v.e));
}
/** NPCs and editor fixtures without a loadout retain their catalog abilities. */
export function equippedAbility(actor: Pick<Actor, 'classId' | 'loadout'>, slot: AbilitySlot): AbilityDef | undefined {
  const abilities = CLASSES[actor.classId].abilities;
  if (!actor.loadout || slot === 'basic') return abilities[slot];
  const id = slot === 'q' ? actor.loadout.q : slot === 'e' ? actor.loadout.e : null;
  return id ? abilities[id] : undefined;
}
export function buildCost(character: Pick<CharacterProgress, 'loadout' | 'configuredTier' | 'xp'>, next: Loadout, classId: ClassId): number {
  if (unlockTier(levelFromXp(character.xp)) > character.configuredTier) return 0;
  const current = normalizeLoadout(character.loadout, levelFromXp(character.xp), classId);
  return [current.q, current.e].filter(Boolean).sort().join(',') === [next.q, next.e].filter(Boolean).sort().join(',') ? 0 : BUILD_COST;
}
export function buildAccent(actor: Pick<Actor, 'classId' | 'loadout'>): string | undefined {
  if (!actor.loadout) return undefined;
  const ids = [actor.loadout.q, actor.loadout.e].filter(Boolean).sort().join(',');
  return ({ q: '#9bdbf2', e: '#d3a6ef', 'e,q': '#9bdbf2', 'q,r': '#f0ce86', 'e,r': '#d3a6ef' } as Record<string, string>)[ids];
}
