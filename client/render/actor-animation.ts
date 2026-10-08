import type { ActorVisual, SpriteAnimation } from '../../shared/actor-catalog';
import type { Actor } from '../../shared/types';
import { BOSS_WAKE_MS, type BossWindup } from '../../shared/bosses';

export interface AnimationState { name: string; elapsed: number; duration?: number; frozen?: boolean; }
/** Missing idle holds the first movement frame for the facing direction. */
export function resolveAnimation(visual: ActorVisual, state: AnimationState): { animation: SpriteAnimation; state: AnimationState } | undefined {
  const exact = visual.animations[state.name];
  if (exact) return { animation: exact, state };
  if (state.name === 'idle' && visual.animations.moving)
    return { animation: visual.animations.moving, state: { ...state, frozen: true } };
  const fallback = visual.animations.idle ?? visual.animations.moving;
  return fallback ? { animation: fallback, state: { ...state, frozen: true } } : undefined;
}
export function bossAnimation(actor: Actor, time: number, moving: boolean, windup?: BossWindup, meleeMs = 520): AnimationState {
  if (actor.hp <= 0) return { name: 'death', elapsed: actor.bossDiedAt === undefined ? Infinity : Math.max(0, time - actor.bossDiedAt) };
  if (windup) return { name: windup.kind, elapsed: Math.max(0, time - windup.startedAt), duration: windup.resolvesAt - windup.startedAt };
  if (actor.bossMeleeAt !== undefined && time >= actor.bossMeleeAt && time < actor.bossMeleeAt + meleeMs)
    return { name: 'melee', elapsed: time - actor.bossMeleeAt };
  if (actor.bossAwakenedAt === undefined) return { name: 'prep', elapsed: 0, frozen: true };
  if (time < actor.bossAwakenedAt + BOSS_WAKE_MS) return { name: 'prep', elapsed: Math.max(0, time - actor.bossAwakenedAt), duration: BOSS_WAKE_MS };
  return { name: moving ? 'walk' : 'idle', elapsed: time };
}
export function animationFrame(animation: SpriteAnimation, state: AnimationState, row: number): number {
  const count = animation.columns * (animation.directional ? 1 : animation.rows);
  const elapsed = state.frozen ? 0 : state.elapsed;
  const duration = state.duration ?? animation.durationMs ?? count * (animation.frameMs ?? 130);
  let frame = Number.isFinite(elapsed) ? Math.floor(elapsed / Math.max(1, duration) * count) : count - 1;
  frame = animation.loop ? frame % count : Math.min(count - 1, frame);
  return (animation.directional ? Math.max(0, Math.min(3, row)) * animation.columns : 0) + Math.max(0, frame);
}
