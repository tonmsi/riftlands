import type { ClassId, Vec2 } from './types';
import { DUNGEON_BY_ID, MAZE_DUNGEON, RUINS_DUNGEON, insideDungeonRegion } from './dungeons';

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
export interface BossLockState { bossId: string; locked: boolean; ownerId?: string; relation?: 'participant' | 'eliminated' | 'outsider'; }
export interface BossPreparationState { bossId: string; name: string; endsAt: number; entrants: number; }

export const RUINS_WARDEN: BossDefinition = {
  id: RUINS_DUNGEON.bossId, dungeonId: RUINS_DUNGEON.id,
  name: 'Custode delle Rovine', skin: 'stone-warden', classId: 'warrior',
  radius: 28, hp: 460, speed: 100, level: 5,
  attacks: [
    { kind: 'melee', damage: 18, range: 82, radius: 82, windupMs: 0, cooldownMs: 1450 },
    { kind: 'slam', damage: 31, range: 285, radius: 145, windupMs: 850, cooldownMs: 1450 },
    { kind: 'melee', damage: 18, range: 82, radius: 82, windupMs: 0, cooldownMs: 1450 },
    { kind: 'charge', damage: 27, range: 285, radius: 38, windupMs: 700, cooldownMs: 1450, travel: 250 },
    { kind: 'melee', damage: 18, range: 82, radius: 82, windupMs: 0, cooldownMs: 1450 },
    { kind: 'nova', damage: 24, range: 285, radius: 235, innerRadius: 82, windupMs: 1100, cooldownMs: 1450 },
  ],
  behavior: {
    targeting: 'threat', attackSelection: 'sequence', preferredRange: 68, pathRefreshMs: 550,
    unstuck: { afterMs: 900, durationMs: 550, probeDistance: 54 },
  },
  enrageAt: 0.45, enrageSpeed: 1.24, enrageCooldown: 0.72,
  reward: { gold: 50, lootMs: 120_000 }, respawnMs: 60_000,
};

/** No dedicated sprite exists for this boss: clients intentionally use the procedural fallback. */
export const MAZE_STALKER: BossDefinition = {
  id: MAZE_DUNGEON.bossId, dungeonId: MAZE_DUNGEON.id,
  name: 'Predatore del Dedalo', skin: 'maze-stalker', classId: 'warrior',
  radius: 25, hp: 620, speed: 118, level: 8,
  attacks: [
    { kind: 'charge', damage: 34, range: 330, radius: 34, windupMs: 520, cooldownMs: 1050, travel: 300 },
    { kind: 'melee', damage: 21, range: 76, radius: 76, windupMs: 0, cooldownMs: 900 },
    { kind: 'slam', damage: 27, range: 190, radius: 105, windupMs: 620, cooldownMs: 1000 },
    { kind: 'nova', damage: 22, range: 280, radius: 210, innerRadius: 105, windupMs: 850, cooldownMs: 1200 },
  ],
  behavior: { targeting: 'nearest', attackSelection: 'distance', preferredRange: 105, pathRefreshMs: 260 },
  enrageAt: 0.55, enrageSpeed: 1.38, enrageCooldown: 0.62,
  reward: { gold: 75, lootMs: 120_000 }, respawnMs: 75_000,
};

export const BOSS_DEFINITIONS: readonly BossDefinition[] = [RUINS_WARDEN, MAZE_STALKER];
export const BOSS_BY_ID = new Map(BOSS_DEFINITIONS.map(definition => [definition.id, definition]));
for (const definition of BOSS_DEFINITIONS) {
  const dungeon = DUNGEON_BY_ID.get(definition.dungeonId);
  if (!dungeon || dungeon.bossId !== definition.id) throw new Error(`Boss ${definition.id}: dungeon ${definition.dungeonId} assente o non associato.`);
  const unstuck = definition.behavior.unstuck;
  if (unstuck && (![unstuck.afterMs, unstuck.durationMs, unstuck.probeDistance].every(Number.isFinite)
    || unstuck.afterMs <= 0 || unstuck.durationMs <= 0 || unstuck.probeDistance <= definition.radius)) {
    throw new Error(`Boss ${definition.id}: configurazione anti-incastro non valida.`);
  }
}

export function validBossState(value: unknown, definition: BossDefinition): value is BossState {
  const state = value as BossState;
  const dungeon = DUNGEON_BY_ID.get(definition.dungeonId);
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
