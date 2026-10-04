import type { Account } from './store';
import type { ClassId } from '../shared/types';
import { levelFromXp } from '../shared/config';
import { newCharacter, normalizeLoadout, unlockTier, validLoadout, buildCost, type CharacterProgress } from '../shared/progression';

/** Pure state operations, also used by the browser's isolated dungeon simulation. */
export function characterFor(account: Account, classId: ClassId): CharacterProgress {
  if (!account.characters) {
    account.characters = {};
    const legacyClass = account.body?.classId ?? classId;
    const legacy = newCharacter(legacyClass);
    if (legacyClass !== 'hunter') legacy.xp = Math.max(0, account.xp);
    legacy.inventory = account.inventory ?? legacy.inventory;
    legacy.narrative = account.narrative ?? legacy.narrative;
    legacy.loadout = normalizeLoadout(account.body?.loadout, levelFromXp(legacy.xp), legacyClass);
    account.characters[legacyClass] = legacy;
  }
  return account.characters[classId] ??= newCharacter(classId);
}
export function activateCharacter(account: Account, classId: ClassId): CharacterProgress {
  const character = characterFor(account, classId);
  account.inventory = character.inventory; account.narrative = character.narrative;
  return character;
}
export function saveCharacterBuild(account: Account, classId: ClassId, loadout: unknown): number {
  const character = characterFor(account, classId), level = levelFromXp(character.xp);
  if (!validLoadout(loadout, level, classId)) throw new Error('Scegli abilità sbloccate e diverse nei due slot.');
  const cost = buildCost(character, loadout, classId);
  if ((account.gold ?? 0) < cost) throw new Error('Servono 10 gold per cambiare build.');
  account.gold = (account.gold ?? 0) - cost;
  character.loadout = { q: loadout.q, e: loadout.e };
  character.configuredTier = unlockTier(level);
  return cost;
}
