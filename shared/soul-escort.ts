import { CLASSES } from './config';
import type { NarrativeProgress } from './narrative';
import type { Actor } from './types';

export const SOUL_QUEST_ID = 'souls-home';
export const SOUL_COUNT = 5;
export const SOUL_HEALTH_MULTIPLIER = 1.25;
export const SOUL_FAREWELL_MS = 9000;
/** Derive the bonus from persisted quest progress, never from a timer or client command. */
export function syncSoulEscort(actor: Actor, progress: NarrativeProgress | undefined, world: boolean): void {
  const active = world && progress?.quests[SOUL_QUEST_ID]?.status === 'active';
  const maxHp = Math.round(CLASSES[actor.classId].maxHp * (active ? SOUL_HEALTH_MULTIPLIER : 1));
  if (actor.maxHp !== maxHp) {
    actor.hp = Math.max(0, Math.min(maxHp, actor.hp / actor.maxHp * maxHp));
    actor.maxHp = maxHp;
  }
  actor.soulEscort = active || undefined;
}
