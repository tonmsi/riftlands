import type { ClassId, Vec2 } from './types';
import { DUNGEON_BY_BOSS_ID, insideDungeonRegion } from './dungeons';
import customDungeons from './custom-dungeons.json';

export type BossAttackKind = 'melee' | 'slam' | 'charge' | 'nova';
export interface BossAttackDefinition {
  kind: BossAttackKind;
  damage: number;
  range: number;
  radius: number;
  windupMs: number;
  cooldownMs: number;
  innerRadius?: number;
  travel?: number;
}
export interface BossBehaviorDefinition {
  targeting: 'threat' | 'nearest' | 'lowest-health';
  attackSelection: 'sequence' | 'distance';
  preferredRange: number;
  pathRefreshMs: number;
  unstuck?: { afterMs: number; durationMs: number; probeDistance: number };
}
export interface BossDefinition {
  templateId?: string;
  id: string;
  dungeonId: string;
  name: string;
  skin: string;
  classId: ClassId;
  radius: number;
  hp: number;
  speed: number;
  level: number;
  attacks: readonly BossAttackDefinition[];
  behavior: BossBehaviorDefinition;
  enrageAt: number;
  enrageSpeed: number;
  enrageCooldown: number;
  reward: { gold: number; lootMs: number };
  respawnMs: number;
}
export interface BossDrop extends Vec2 { id: string; bossId: string; ownerId: string; amount: number; availableAt: number; expiresAt: number; }
export interface BossState { respawnAt: number; corpse: Vec2; drops: BossDrop[]; }
export interface BossWindup extends Vec2 {
  bossId: string;
  kind: BossAttackKind;
  radius: number;
  startedAt: number;
  resolvesAt: number;
  damage: number;
  targetX?: number;
  targetY?: number;
  innerRadius?: number;
}
export const DUNGEON_ENTRY_MS = 900;
export const DUNGEON_ARRIVAL_MS = 1200;
export interface BossLockState { bossId: string; locked: boolean; startedAt?: number; ownerId?: string; relation?: 'participant' | 'eliminated' | 'outsider'; }
export interface BossPreparationState { bossId: string; name: string; startedAt: number; endsAt: number; entrants: number; team: boolean; }

export const BOSS_DEFINITIONS: readonly BossDefinition[] =
  (customDungeons as { bosses: BossDefinition[] }[]).flatMap(entry => entry.bosses);
export const BOSS_BY_ID = new Map(BOSS_DEFINITIONS.map(definition => [definition.id, definition]));
for (const definition of BOSS_DEFINITIONS) {
  const dungeon = DUNGEON_BY_BOSS_ID.get(definition.id);
  if (!dungeon || dungeon.id !== definition.dungeonId) throw new Error(`Boss ${definition.id}: dungeon ${definition.dungeonId} assente o non associato.`);
  const unstuck = definition.behavior.unstuck;
  if (unstuck && (![unstuck.afterMs, unstuck.durationMs, unstuck.probeDistance].every(Number.isFinite)
    || unstuck.afterMs <= 0 || unstuck.durationMs <= 0 || unstuck.probeDistance <= definition.radius)) {
    throw new Error(`Boss ${definition.id}: configurazione anti-incastro non valida.`);
  }
}

export function validBossState(value: unknown, definition: BossDefinition): value is BossState {
  const state = value as BossState;
  const dungeon = DUNGEON_BY_BOSS_ID.get(definition.id);
  return !!state && Number.isFinite(state.respawnAt) && state.respawnAt >= 0 && !!state.corpse
    && !!dungeon && [state.corpse.x, state.corpse.y].every(Number.isFinite) && insideDungeonRegion(dungeon.encounter.regions.combat, state.corpse, 400)
    && Array.isArray(state.drops) && state.drops.length <= 10 && new Set(state.drops.map(drop => drop?.id)).size === state.drops.length
    && state.drops.every(drop => drop && typeof drop.id === 'string' && drop.bossId === definition.id
      && typeof drop.ownerId === 'string' && Number.isSafeInteger(drop.amount) && drop.amount > 0 && drop.amount <= definition.reward.gold
      && [drop.x, drop.y, drop.availableAt, drop.expiresAt].every(Number.isFinite) && drop.expiresAt > drop.availableAt
      && insideDungeonRegion(dungeon.encounter.regions.combat, drop, 400));
}

export function validBossStates(value: unknown): value is Record<string, BossState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= BOSS_DEFINITIONS.length && entries.every(([id, state]) => {
    const definition = BOSS_BY_ID.get(id);
    return !!definition && validBossState(state, definition);
  });
}
