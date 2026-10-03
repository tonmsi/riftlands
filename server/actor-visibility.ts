import type { Actor } from '../shared/types';

/** Shared by combat targeting and replication; hidden enemies must never leak through an index. */
export function actorVisibleTo(observer: Actor, target: Actor, now: number): boolean {
  return target.id === observer.id || (!!observer.teamId && target.teamId === observer.teamId)
    || !target.hidden || target.revealedUntil > now || Math.hypot(observer.x - target.x, observer.y - target.y) < 120;
}
