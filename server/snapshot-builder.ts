import { INTEREST_RADIUS } from '../shared/config';
import type { Actor, GameEvent, Pickup, Projectile, RoomMode, Snapshot, Trap, Vec2 } from '../shared/types';
import { projectActor } from '../shared/snapshot-actor';
import type { SnapshotActor } from '../shared/snapshot-actor';
import type { Account } from './store';
import type { BossEncounter } from './boss-encounter';
import type { InteractionSystem } from './interactions';
import type { FishingSystem } from './fishing/fishing-system';
import { actorVisibleTo } from './actor-visibility';
import { SnapshotPrivateState } from './snapshot-private-state';

interface SnapshotSource {
  players: ReadonlyMap<string, Actor>; npcs: ReadonlyMap<string, Actor>;
  connections: ReadonlyMap<string, { ack: number; connected: boolean }>;
  accounts: ReadonlyMap<string, Account>; bosses: ReadonlyMap<string, BossEncounter>;
  projectiles: ReadonlyMap<string, Projectile>; pickups: ReadonlyMap<string, Pickup>; traps: ReadonlyMap<string, Trap>;
  events: readonly GameEvent[]; activeChunks: ReadonlyMap<string, unknown>; interactions: InteractionSystem;
  tick: number; now: number; mode: RoomMode; fishing?: FishingSystem;
}
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const CELL_SIZE = 768;

/** Replication has its own index: unlike combat, it must retain corpses. */
export class SnapshotBuilder {
  private cells = new Map<string, Actor[]>();
  private teams = new Map<string, Actor[]>();
  private indexedTick = -1;
  private indexedCount = -1;
  private projected = new Map<Actor, SnapshotActor>();
  private readonly privateState = new SnapshotPrivateState();
  constructor(private readonly source: SnapshotSource) {}
  invalidate(): void { this.indexedTick = -1; this.projected.clear(); }
  private actor(actor: Actor): SnapshotActor {
    let projected = this.projected.get(actor);
    if (!projected) {
      projected = projectActor(actor);
      for (const effect of projected.effects) Object.freeze(effect);
      Object.freeze(projected.effects); Object.freeze(projected.cooldowns); if (projected.loadout) Object.freeze(projected.loadout); Object.freeze(projected);
      this.projected.set(actor, projected);
    }
    return projected;
  }
  private near(observer: Actor): Actor[] {
    const source = this.source, count = source.players.size + source.npcs.size;
    if (this.indexedTick !== source.tick || this.indexedCount !== count) {
      this.cells.clear();
      this.teams.clear();
      this.projected.clear();
      this.privateState.prune(source.players);
      for (const actors of [source.players, source.npcs]) for (const actor of actors.values()) {
        const key = `${Math.floor(actor.x / CELL_SIZE)},${Math.floor(actor.y / CELL_SIZE)}`;
        const bucket = this.cells.get(key) ?? []; bucket.push(actor); this.cells.set(key, bucket);
        if (actor.teamId) {
          const team = this.teams.get(actor.teamId) ?? []; team.push(actor); this.teams.set(actor.teamId, team);
        }
      }
      this.indexedTick = source.tick; this.indexedCount = count;
    }
    const found = new Map<string, Actor>();
    for (let y = Math.floor((observer.y - INTEREST_RADIUS) / CELL_SIZE); y <= Math.floor((observer.y + INTEREST_RADIUS) / CELL_SIZE); y++)
      for (let x = Math.floor((observer.x - INTEREST_RADIUS) / CELL_SIZE); x <= Math.floor((observer.x + INTEREST_RADIUS) / CELL_SIZE); x++)
        for (const actor of this.cells.get(`${x},${y}`) ?? []) if (distance(observer, actor) < INTEREST_RADIUS) found.set(actor.id, actor);
    found.set(observer.id, observer);
    // Preserve off-screen teammates using the same rules for all actor kinds.
    if (observer.teamId) for (const actor of this.teams.get(observer.teamId) ?? []) found.set(actor.id, actor);
    return [...found.values()].filter(actor => actorVisibleTo(observer, actor, source.now));
  }
  build(id: string): Snapshot | undefined {
    const s = this.source, self = s.players.get(id), connection = s.connections.get(id);
    if (!self || !connection) return undefined;
    const actors = this.near(self).map(actor => {
      const projected = this.actor(actor);
      if (actor.dialogueId) return Object.freeze({ ...projected, questMarker: s.interactions.marker(id, actor.dialogueId, s.now) });
      return projected;
    });
    const visibleIds = new Set(actors.map(actor => actor.id));
    const account = s.accounts.get(id);
    return {
      type: 'snapshot', tick: s.tick, time: s.now, ack: connection.ack, self: this.actor(self), actors,
      gold: account?.gold ?? 0,
      ...this.privateState.read(id, account),
      inventoryActions: s.interactions.feedback(id, s.now),
      fishing: s.fishing?.view(id) ?? null,
      fishingAvailable: s.mode === 'world' && s.fishing?.available(id),
      ...(s.mode === 'world' ? { groundItems: s.interactions.visibleDrops(id, s.now, INTEREST_RADIUS), dialogue: s.interactions.view(id, s.now) } : { groundItems: [], dialogue: null }),
      goldDrops: [...s.bosses.values()].flatMap(encounter => encounter.state.drops.filter(drop => drop.ownerId === id && drop.expiresAt > s.now && distance(self, drop) < INTEREST_RADIUS).map(drop => ({ ...drop }))),
      bossWindups: [...s.bosses.values()].flatMap(encounter => encounter.windup && distance(self, encounter.windup) < INTEREST_RADIUS ? [{ ...encounter.windup }] : []),
      bossLocks: [...s.bosses.values()].map(encounter => encounter.lockState(self)),
      bossPreparations: [...s.bosses.values()].flatMap(encounter => encounter.preparationFor(self) ?? []),
      projectiles: [...s.projectiles.values()].filter(p => distance(self, p) < INTEREST_RADIUS).map(p => ({ ...p })),
      pickups: [...s.pickups.values()].filter(p => distance(self, p) < INTEREST_RADIUS).map(p => ({ ...p })),
      traps: [...s.traps.values()].filter(p => distance(self, p) < INTEREST_RADIUS).map(p => ({ ...p })),
      events: s.events.filter(event => distance(self, event) < INTEREST_RADIUS && (!event.actorId || visibleIds.has(event.actorId)) && (!event.targetId || visibleIds.has(event.targetId))).map(event => ({ ...event })),
      online: [...s.connections.values()].filter(c => c.connected).length, activeChunks: s.activeChunks.size,
    };
  }
}
