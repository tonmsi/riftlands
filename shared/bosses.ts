import type { ClassId, Vec2 } from './types';
import { RUINS, inRuins } from './ruins';

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
export interface BossDefinition {
  id: string;
  name: string;
  skin: string;
  classId: ClassId;
  position: Vec2;
  radius: number;
  hp: number;
  speed: number;
  level: number;
  aggroRadius: number;
  arena: { radius: number; entryRadius: number; exit: Vec2; sealedTiles: readonly Vec2[] };
  attacks: readonly BossAttackDefinition[];
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
export interface BossLockState { bossId: string; locked: boolean; ownerId?: string; }

const ruinsSeal = [-87, -74].flatMap(ty => [-2, -1, 0, 1].map(tx => ({ x: tx, y: ty })));
export const RUINS_WARDEN: BossDefinition = {
  id: 'boss:ruins:warden', name: 'Custode delle Rovine', skin: 'stone-warden', classId: 'warrior',
  position: { x: RUINS.x, y: RUINS.y }, radius: 28, hp: 460, speed: 100, level: 5,
  aggroRadius: RUINS.radius, arena: { radius: RUINS.radius, entryRadius: 260, exit: { x: RUINS.x, y: RUINS.y + 390 }, sealedTiles: ruinsSeal },
  attacks: [
    { kind: 'melee', damage: 18, range: 82, radius: 82, windupMs: 0, cooldownMs: 1450 },
    { kind: 'slam', damage: 31, range: 285, radius: 145, windupMs: 850, cooldownMs: 1450 },
    { kind: 'melee', damage: 18, range: 82, radius: 82, windupMs: 0, cooldownMs: 1450 },
    { kind: 'charge', damage: 27, range: 285, radius: 38, windupMs: 700, cooldownMs: 1450, travel: 250 },
    { kind: 'melee', damage: 18, range: 82, radius: 82, windupMs: 0, cooldownMs: 1450 },
    { kind: 'nova', damage: 24, range: 285, radius: 235, innerRadius: 82, windupMs: 1100, cooldownMs: 1450 },
  ],
  enrageAt: 0.45, enrageSpeed: 1.24, enrageCooldown: 0.72,
  reward: { gold: 50, lootMs: 120_000 }, respawnMs: 60_000,
};

export const BOSS_DEFINITIONS: readonly BossDefinition[] = [RUINS_WARDEN];
export const BOSS_BY_ID = new Map(BOSS_DEFINITIONS.map(definition => [definition.id, definition]));

export function insideBossArena(definition: BossDefinition, position: Vec2, margin = 0): boolean {
  return Math.hypot(position.x - definition.position.x, position.y - definition.position.y) < definition.arena.radius + margin;
}

export function insideBossEntry(definition: BossDefinition, position: Vec2): boolean {
  return Math.hypot(position.x - definition.position.x, position.y - definition.position.y) < definition.arena.entryRadius;
}

export function validBossState(value: unknown, definition: BossDefinition, legacy = false): value is BossState {
  const state = value as BossState;
  return !!state && Number.isFinite(state.respawnAt) && state.respawnAt >= 0 && !!state.corpse
    && [state.corpse.x, state.corpse.y].every(Number.isFinite) && insideBossArena(definition, state.corpse, 400)
    && Array.isArray(state.drops) && state.drops.length <= 10 && new Set(state.drops.map(drop => drop?.id)).size === state.drops.length
    && state.drops.every(drop => drop && typeof drop.id === 'string' && (legacy || drop.bossId === definition.id)
      && typeof drop.ownerId === 'string' && Number.isSafeInteger(drop.amount) && drop.amount > 0 && drop.amount <= definition.reward.gold
      && [drop.x, drop.y, drop.availableAt, drop.expiresAt].every(Number.isFinite) && drop.expiresAt > drop.availableAt
      && insideBossArena(definition, drop, 400));
}

export function validBossStates(value: unknown): value is Record<string, BossState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= BOSS_DEFINITIONS.length && entries.every(([id, state]) => {
    const definition = BOSS_BY_ID.get(id);
    return !!definition && validBossState(state, definition);
  });
}

export function isSealedBossTile(tx: number, ty: number, locked: ReadonlySet<string>): boolean {
  for (const definition of BOSS_DEFINITIONS) if (locked.has(definition.id) && definition.arena.sealedTiles.some(tile => tile.x === tx && tile.y === ty)) return true;
  return false;
}

export function normalizeLegacyBossState(value: unknown): BossState | undefined {
  if (!validBossState(value, RUINS_WARDEN, true)) return undefined;
  return { ...value, drops: value.drops.map(drop => ({ ...drop, bossId: RUINS_WARDEN.id })) };
}

