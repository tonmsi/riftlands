import { INTERACTION_RANGE } from '../../shared/interactions';
import { hasLineOfSight } from '../../shared/physics';
import type { Actor } from '../../shared/types';
import type { World } from '../../shared/world';

/** Selection has no talk range restriction; only opening dialogue requires proximity. */
export function canTalkToNpc(self: Actor | null, target: Actor, world: World): boolean {
  return !!self && self.hp > 0 && target.hp > 0 && !!target.dialogueId
    && Math.hypot(target.x - self.x, target.y - self.y) <= INTERACTION_RANGE && hasLineOfSight(self, target, world);
}
