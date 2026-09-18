import type { Actor, Vec2 } from '../shared/types';

/** Presentation only: authoritative/predicted states never receive smoothed coordinates. */
export class LocalMovementView {
  private previous: Vec2 | null = null;
  private offset: Vec2 = { x: 0, y: 0 };

  reset(actor?: Actor): void {
    this.previous = actor ? { x: actor.x, y: actor.y } : null;
    this.offset = { x: 0, y: 0 };
  }

  advance(before: Actor, after: Actor): void {
    if (this.discontinuity(before, after)) this.reset(after);
    else this.previous = { x: before.x, y: before.y };
  }

  correct(before: Actor | null, after: Actor): void {
    if (!before || !this.previous || this.discontinuity(before, after)) { this.reset(after); return; }
    const dx = after.x - before.x, dy = after.y - before.y;
    // Rebase both endpoints, then compensate visually. An ACK between ticks cannot restart a step.
    this.previous.x += dx; this.previous.y += dy;
    this.offset.x -= dx; this.offset.y -= dy;
    if (Math.hypot(this.offset.x, this.offset.y) > 100) this.reset(after);
  }

  sample(current: Actor, alpha: number, deltaSeconds: number): Actor {
    const previous = this.previous ?? current;
    const t = Math.max(0, Math.min(1, alpha));
    const decay = Math.exp(-18 * Math.max(0, deltaSeconds));
    this.offset.x *= decay; this.offset.y *= decay;
    return {
      ...current,
      x: previous.x + (current.x - previous.x) * t + this.offset.x,
      y: previous.y + (current.y - previous.y) * t + this.offset.y,
    };
  }

  private discontinuity(before: Actor, after: Actor): boolean {
    return before.id !== after.id || before.classId !== after.classId || (before.hp <= 0) !== (after.hp <= 0)
      || before.deadUntil !== after.deadUntil || Math.hypot(after.x - before.x, after.y - before.y) > 100;
  }
}
