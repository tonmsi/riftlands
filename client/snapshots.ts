import type { Actor, Projectile, Snapshot } from '../shared/types';
import { interpolateActor } from './prediction';

const MIN_BUFFER_MS = 150;
const MAX_BUFFER_MS = 300;
const RESET_GAP_MS = 1000;
const MAX_SNAPSHOTS = 32;

export interface BufferedFrame { self: Actor; actors: Actor[]; projectiles: Projectile[]; time: number; }

/** Remote presentation follows packet arrival time, never the ping-adjusted combat clock. */
export class SnapshotBuffer {
  private snapshots: Snapshot[] = [];
  // Weak keys release indexes as soon as their buffered snapshot is discarded.
  private indexes = new WeakMap<Snapshot, { actors: Map<string, Actor>; projectiles: Map<string, Projectile> }>();
  private lastReceived = 0;
  private lastSample: number | null = null;
  private playhead: number | null = null;
  private jitter = 0;

  clear(): void {
    this.snapshots.length = 0;
    this.indexes = new WeakMap();
    this.lastReceived = 0;
    this.lastSample = this.playhead = null;
    this.jitter = 0;
  }

  push(snapshot: Snapshot, receivedAt: number): void {
    const previous = this.snapshots.at(-1);
    // WebSockets are ordered, but a duplicate welcome snapshot must not shift the clock.
    if (previous && snapshot.time <= previous.time) return;
    if (previous && (receivedAt - this.lastReceived > RESET_GAP_MS || snapshot.self.id !== previous.self.id)) {
      this.clear();
    } else if (previous) {
      const variation = Math.abs((receivedAt - this.lastReceived) - (snapshot.time - previous.time));
      this.jitter += (Math.min(150, variation) - this.jitter) * 0.1;
    }
    this.indexes.set(snapshot, { actors: new Map(snapshot.actors.map(actor => [actor.id, actor])), projectiles: new Map(snapshot.projectiles.map(projectile => [projectile.id, projectile])) });
    this.snapshots.push(snapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
    this.lastReceived = receivedAt;
    if (this.playhead === null) {
      this.playhead = snapshot.time - MIN_BUFFER_MS;
      this.lastSample = receivedAt;
    }
  }

  sample(now: number): BufferedFrame | null {
    const latest = this.snapshots.at(-1);
    if (!latest || this.playhead === null) return null;
    const delay = Math.min(MAX_BUFFER_MS, MIN_BUFFER_MS + this.jitter * 2);
    const target = latest.time + Math.max(0, now - this.lastReceived) - delay;
    const elapsed = Math.max(0, now - (this.lastSample ?? now));
    if (elapsed > RESET_GAP_MS) {
      // A suspended tab resumes around the current buffer instead of replaying seconds of history.
      this.playhead = Math.max(this.playhead, Math.min(latest.time, target));
    } else {
      const error = target - this.playhead;
      const speed = Math.abs(error) < 10 ? 1 : 1 + Math.max(-0.08, Math.min(0.08, error / 1000));
      this.playhead = Math.min(latest.time, this.playhead + elapsed * speed);
    }
    this.lastSample = now;

    // Overflow uses the newest pair, never the oldest/latest pair (a false teleport).
    let before = this.snapshots[0], after = before;
    if (this.playhead > before.time && this.snapshots.length > 1) {
      before = this.snapshots[this.snapshots.length - 2]; after = latest;
      for (let i = 1; i < this.snapshots.length; i++) {
        if (this.snapshots[i].time >= this.playhead) {
          before = this.snapshots[i - 1]; after = this.snapshots[i]; break;
        }
      }
    }
    const alpha = before.time === after.time ? 1 : Math.max(0, Math.min(1, (this.playhead - before.time) / (after.time - before.time)));
    // The playhead never rewinds: older history can no longer be sampled.
    const obsolete = this.snapshots.indexOf(before);
    if (obsolete > 0) this.snapshots.splice(0, obsolete);
    const live = this.indexes.get(latest)!;
    const previous = this.indexes.get(before)!;
    const actors: Actor[] = [];
    for (const actor of after.actors) {
      if (live.actors.has(actor.id)) actors.push(interpolateActor(previous.actors.get(actor.id), actor, alpha));
    }
    const liveProjectiles = live.projectiles;
    const oldProjectiles = previous.projectiles;
    const projectiles: Projectile[] = [];
    for (const projectile of after.projectiles) {
      if (!liveProjectiles.has(projectile.id)) continue;
      const old = oldProjectiles.get(projectile.id);
      // Do not invent flight before the first observation or beyond an authoritative impact.
      if (!old && this.playhead < after.time) continue;
      projectiles.push(old ? {
        ...projectile,
        x: old.x + (projectile.x - old.x) * alpha,
        y: old.y + (projectile.y - old.y) * alpha,
      } : { ...projectile });
    }
    const self = interpolateActor(before.self, after.self, alpha);
    return { self, actors, projectiles, time: this.playhead };
  }
}
