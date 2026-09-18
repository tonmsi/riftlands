import { DT } from '../shared/config';
import { movementSpeed, moveWithCollisions, terrainSpeed } from '../shared/physics';
import type { Actor, InputCommand } from '../shared/types';
import { World } from '../shared/world';
import { playerSpriteDirectionRow } from '../shared/sprite-direction';

/** Only movement changes predicted actor state; speculative combat visuals live separately. */
export function predictMovement(actor: Actor, input: InputCommand, world: World, time: number): Actor {
  const position = moveWithCollisions(actor, input.dx, input.dy, movementSpeed(actor, time) * terrainSpeed(actor, world) * DT, world);
  return { ...actor, ...position, aim: input.aim,
    spriteRow: playerSpriteDirectionRow(input.dx, input.dy, actor.spriteRow ?? 0, input.analogMovement === true),
    spriteMoving: actor.hp > 0 && Math.hypot(input.dx, input.dy) > 0 };
}

export function reconcile(authoritative: Actor, acknowledged: number, pending: InputCommand[], world: World, time: number): { actor: Actor; pending: InputCommand[] } {
  const remaining = pending.filter(input => input.seq > acknowledged);
  let actor = { ...authoritative };
  for (let i = 0; i < remaining.length; i++) actor = predictMovement(actor, remaining[i], world, time + (i + 1) * DT * 1000);
  return { actor, pending: remaining };
}

export function interpolateActor(old: Actor | undefined, actor: Actor, alpha: number): Actor {
  const t = Math.max(0, Math.min(1, alpha));
  if (!old || old.hp <= 0 || actor.hp <= 0 || Math.hypot(actor.x - old.x, actor.y - old.y) > 250) return { ...actor };
  const angle = Math.atan2(Math.sin(actor.aim - old.aim), Math.cos(actor.aim - old.aim));
  return { ...actor, x: old.x + (actor.x - old.x) * t, y: old.y + (actor.y - old.y) * t, aim: old.aim + angle * t };
}

export function interpolateActors(older: Actor[], newer: Actor[], alpha: number): Actor[] {
  const before = new Map(older.map(a => [a.id, a]));
  return newer.map(actor => interpolateActor(before.get(actor.id), actor, alpha));
}
