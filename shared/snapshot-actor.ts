import type { Actor } from './types';

/** Explicit network contract: new simulation fields are never published implicitly. */
export const ACTOR_METADATA_KEYS = ['kind', 'name', 'classId', 'radius', 'maxHp', 'maxResource', 'speed', 'level', 'xp', 'loadout', 'kills', 'deaths', 'npcKind', 'bossKey', 'bossSkin', 'disposition', 'dialogueId'] as const;
export const ACTOR_STATE_KEYS = ['x', 'y', 'hp', 'resource', 'aim', 'teamId', 'hidden', 'revealedUntil', 'deadUntil', 'spawnProtectedUntil', 'pvpUntil', 'effects', 'cooldowns', 'spriteRow', 'spriteMoving', 'bossAwakenedAt', 'bossMeleeAt', 'bossDiedAt', 'questMarker'] as const;
export type ActorMetadata = Pick<Actor, typeof ACTOR_METADATA_KEYS[number]>;
export type ActorState = Pick<Actor, typeof ACTOR_STATE_KEYS[number]>;
export type SnapshotActor = { id: string } & ActorMetadata & ActorState;
const ACTOR_KEYS = [...ACTOR_METADATA_KEYS, ...ACTOR_STATE_KEYS] as const;

export function projectActor(actor: SnapshotActor): SnapshotActor {
  const result = { id: actor.id } as SnapshotActor;
  const fields = result as unknown as Record<string, unknown>;
  for (const key of ACTOR_KEYS) {
    if (actor[key] !== undefined) fields[key] = actor[key];
  }
  result.effects = actor.effects.map(effect => ({ kind: effect.kind, until: effect.until }));
  result.cooldowns = { basic: actor.cooldowns.basic, q: actor.cooldowns.q, e: actor.cooldowns.e, r: actor.cooldowns.r };
  if (actor.loadout) result.loadout = { ...actor.loadout };
  return result;
}
