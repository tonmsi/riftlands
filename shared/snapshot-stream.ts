import type { RoomState, Snapshot } from './types';
import { ACTOR_METADATA_KEYS, ACTOR_STATE_KEYS, projectActor, type ActorMetadata, type ActorState, type SnapshotActor } from './snapshot-actor';

type Identity = Pick<RoomState, 'id' | 'epoch'>;
interface ActorUpdate { id: string; metadata?: ActorMetadata; state?: Partial<ActorState>; clear?: (keyof ActorState)[]; }
export interface SnapshotPacket extends Omit<Snapshot, 'actors'> {
  encoding: 'actors-v1';
  room: Identity;
  sequence: number;
  base: number | null;
  actorUpdates: ActorUpdate[];
  removedActors: string[];
}
const KEYFRAME_INTERVAL = 75;
const sameRoom = (a: Identity | undefined, b: Identity) => a?.id === b.id && a.epoch === b.epoch;
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => sameValue(value, b[i]));
  const first = a as Record<string, unknown>, second = b as Record<string, unknown>;
  const keys = Object.keys(first);
  return keys.length === Object.keys(second).length && keys.every(key => Object.hasOwn(second, key) && sameValue(first[key], second[key]));
}
function metadata(actor: SnapshotActor): ActorMetadata {
  const result = {} as ActorMetadata;
  const fields = result as unknown as Record<string, unknown>;
  for (const key of ACTOR_METADATA_KEYS) if (actor[key] !== undefined) fields[key] = actor[key];
  return result;
}
function updateActor(current: SnapshotActor, previous?: SnapshotActor): ActorUpdate | undefined {
  const update: ActorUpdate = { id: current.id };
  if (!previous || ACTOR_METADATA_KEYS.some(key => current[key] !== previous[key])) update.metadata = metadata(current);
  const state: Partial<ActorState> = {}, clear: (keyof ActorState)[] = [];
  for (const key of ACTOR_STATE_KEYS) {
    if (previous && sameValue(current[key], previous[key])) continue;
    if (current[key] === undefined) { if (previous?.[key] !== undefined) clear.push(key); }
    else (state as Record<string, unknown>)[key] = current[key];
  }
  if (Object.keys(state).length) update.state = state;
  if (clear.length) update.clear = clear;
  return update.metadata || update.state || update.clear ? update : undefined;
}

// All recipients often compare the same two immutable tick projections. Compute that
// difference once; slow recipients still use their own actually delivered baseline.
const actorDeltas = new WeakMap<SnapshotActor, WeakMap<SnapshotActor, ActorUpdate | undefined>>();
const actorSpawns = new WeakMap<SnapshotActor, ActorUpdate>();
function freezeUpdate(update: ActorUpdate | undefined): ActorUpdate | undefined {
  if (!update) return undefined;
  if (update.metadata) Object.freeze(update.metadata);
  if (update.state) Object.freeze(update.state);
  if (update.clear) Object.freeze(update.clear);
  return Object.freeze(update);
}
function actorDelta(current: SnapshotActor, previous?: SnapshotActor): ActorUpdate | undefined {
  if (!Object.isFrozen(current) || (previous && !Object.isFrozen(previous))) return updateActor(current, previous);
  if (!previous) {
    let update = actorSpawns.get(current);
    if (!update) { update = freezeUpdate(updateActor(current))!; actorSpawns.set(current, update); }
    return update;
  }
  let history = actorDeltas.get(current);
  if (!history) { history = new WeakMap(); actorDeltas.set(current, history); }
  if (history.has(previous)) return history.get(previous);
  const update = freezeUpdate(updateActor(current, previous));
  history.set(previous, update); return update;
}

/** One stream per recipient. Preparing an unsent packet never advances its baseline. */
export class SnapshotEncoder {
  private room?: Identity;
  private sequence = 0;
  private actors = new Map<string, SnapshotActor>();
  private inventory?: Snapshot['inventory'];
  private narrative?: Snapshot['narrative'];
  private gold?: number;

  prepare(snapshot: Snapshot, room: Identity): { packet: SnapshotPacket; commit: () => void } {
    const sequence = this.sequence;
    const reset = !sameRoom(this.room, room) || sequence % KEYFRAME_INTERVAL === 0;
    const actors = new Map<string, SnapshotActor>(), actorUpdates: ActorUpdate[] = [];
    for (const actor of snapshot.actors) {
      if (actor.id === snapshot.self.id) continue; // self is already sent for reconciliation.
      // The builder publishes immutable projections shared by recipients for this tick.
      // Other callers get a detached copy so mutating a fixture cannot alter the baseline.
      const current = Object.isFrozen(actor) ? actor : projectActor(actor);
      actors.set(actor.id, current);
      const update = actorDelta(current, reset ? undefined : this.actors.get(actor.id));
      if (update) actorUpdates.push(update);
    }
    const { actors: _actors, inventory, narrative, gold, ...frame } = snapshot;
    const nextInventory = reset || !sameValue(inventory, this.inventory) ? structuredClone(inventory) : this.inventory;
    const nextNarrative = reset || !sameValue(narrative, this.narrative) ? structuredClone(narrative) : this.narrative;
    const packet: SnapshotPacket = {
      ...frame, self: projectActor(snapshot.self), encoding: 'actors-v1', room: { ...room }, sequence: sequence + 1,
      base: reset ? null : sequence, actorUpdates,
      removedActors: reset ? [] : [...this.actors.keys()].filter(id => !actors.has(id)),
      ...(reset || nextInventory !== this.inventory ? { inventory: nextInventory } : {}),
      ...(reset || nextNarrative !== this.narrative ? { narrative: nextNarrative } : {}),
      ...(reset || gold !== this.gold ? { gold } : {}),
    };
    return { packet, commit: () => {
      if (this.sequence !== sequence) throw new Error('Snapshot baseline already advanced.');
      this.sequence = packet.sequence; this.room = packet.room; this.actors = actors;
      this.inventory = nextInventory; this.narrative = nextNarrative; this.gold = gold;
    } };
  }
}

/** Rebuild immutable full frames before prediction, interpolation or UI sees them. */
export class SnapshotDecoder {
  private room?: Identity;
  private sequence = 0;
  private actors = new Map<string, SnapshotActor>();
  private inventory?: Snapshot['inventory'];
  private gold?: number;
  reset(room?: Identity): void {
    this.room = room; this.sequence = 0; this.actors.clear(); this.inventory = undefined; this.gold = undefined;
  }
  decode(packet: SnapshotPacket): Snapshot {
    if (this.room && !sameRoom(this.room, packet.room)) throw new Error('Snapshot belongs to another room.');
    if (packet.sequence <= this.sequence || (packet.base !== null && packet.base !== this.sequence)) throw new Error('Snapshot baseline unavailable.');
    const actors = packet.base === null ? new Map<string, SnapshotActor>() : new Map(this.actors);
    for (const id of packet.removedActors) actors.delete(id);
    for (const update of packet.actorUpdates) {
      const previous = actors.get(update.id);
      if (!previous && !update.metadata) throw new Error('Unknown snapshot actor.');
      // Full metadata replacement also removes optional metadata that disappeared.
      const state: Partial<ActorState> = {};
      if (previous) for (const key of ACTOR_STATE_KEYS) if (previous[key] !== undefined) (state as Record<string, unknown>)[key] = previous[key];
      Object.assign(state, update.state);
      for (const key of update.clear ?? []) delete state[key];
      const actor = { id: update.id, ...(update.metadata ?? metadata(previous!)), ...state } as SnapshotActor;
      if (!actor.cooldowns || !actor.effects || !Number.isFinite(actor.x) || !Number.isFinite(actor.hp)) throw new Error('Incomplete snapshot actor.');
      actors.set(update.id, projectActor(actor));
    }
    const { encoding: _encoding, room: _room, sequence: _sequence, base: _base, actorUpdates: _updates, removedActors: _removed, ...frame } = packet;
    const inventory = packet.inventory ?? (packet.base === null ? undefined : this.inventory);
    const gold = packet.gold ?? (packet.base === null ? undefined : this.gold);
    const snapshot: Snapshot = { ...frame, self: projectActor(packet.self), actors: [projectActor(packet.self), ...actors.values()].map(projectActor), inventory: structuredClone(inventory), gold };
    this.actors = actors; this.sequence = packet.sequence; this.room = packet.room; this.inventory = inventory; this.gold = gold;
    return snapshot;
  }
}
