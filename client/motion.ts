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

/** Delays only the local presentation; input and authoritative simulation stay immediate. */
export class LocalPresentationDelay {
  private samples: { at: number; actor: Actor }[] = [];

  constructor(private readonly delayMs = 150) {}

  reset(): void { this.samples = []; }

  sample(actor: Actor, now: number): Actor {
    this.samples.push({ at: now, actor: { ...actor } });
    const target = now - this.delayMs;
    while (this.samples.length > 2 && this.samples[1].at <= target) this.samples.shift();
    const before = this.samples[0];
    const after = this.samples[1] ?? before;
    if (before.actor.id !== actor.id || after.actor.id !== actor.id) return actor;
    const alpha = before.at === after.at ? 1 : Math.max(0, Math.min(1, (target - before.at) / (after.at - before.at)));
    const angle = Math.atan2(Math.sin(after.actor.aim - before.actor.aim), Math.cos(after.actor.aim - before.actor.aim));
    return {
      ...actor,
      x: before.actor.x + (after.actor.x - before.actor.x) * alpha,
      y: before.actor.y + (after.actor.y - before.actor.y) * alpha,
      aim: before.actor.aim + angle * alpha,
    };
  }
}
