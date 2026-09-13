import { randomUUID } from 'node:crypto';
import { DT, WORLD_SEED } from '../shared/config';
import { ARENA_GATE, ARENA_DURATION_SECONDS, insideArenaGate } from '../shared/arena';
import { inOutpost } from '../shared/outpost';
import type { ClassId, InputCommand, RoomMode, RoomState, SocialState, ArenaGateState } from '../shared/types';
import type { Account, AccountStore } from './store';
import { WorldSimulation, type SocialAction } from './simulation';

type Membership = { roomId: string; epoch: number; account: Account; classId: ClassId; connected: boolean; expiresAt?: number };
export interface MatchRoom {
  id: string;
  mode: Exclude<RoomMode, 'world'>;
  simulation: WorldSimulation;
  members: Set<string>;
  endsAt: number;
}

/** One owner for routing and persistent characters. Match accounts are disposable copies. */
export class RoomManager {
  readonly global: WorldSimulation;
  readonly rooms = new Map<string, MatchRoom>();
  private readonly memberships = new Map<string, Membership>();
  private readonly gateEntries = new Map<string, number>();
  private readonly mustExitGate = new Set<string>();
  private gatePair?: { ids: [string, string]; startsAt: number };
  private readonly notices = new Map<string, string>();
  constructor(private readonly store?: AccountStore, seed = WORLD_SEED, now = Date.now()) {
    this.global = new WorldSimulation(seed, now, store);
  }

  private membership(id: string): Membership {
    const member = this.memberships.get(id);
    if (!member) throw new Error('Sessione non disponibile.');
    return member;
  }

  simulationFor(id: string): WorldSimulation {
    const member = this.membership(id);
    return member.roomId === 'world' ? this.global : this.rooms.get(member.roomId)!.simulation;
  }

  stateFor(id: string): RoomState {
    const member = this.membership(id), sim = this.simulationFor(id);
    return { id: member.roomId, epoch: member.epoch, mode: sim.mode, seed: sim.seed };
  }

  connect(account: Account, classId: ClassId) {
    let member = this.memberships.get(account.id);
    if (member?.roomId !== 'world' && member?.expiresAt !== undefined && member.expiresAt <= this.global.now) this.returnToWorld(account.id);
    member = this.memberships.get(account.id);
    const sim = member ? this.simulationFor(account.id) : this.global;
    const actor = sim.addPlayer(member && member.roomId !== 'world' ? sim.accounts.get(account.id)! : account,
      member && member.roomId !== 'world' ? member.classId : classId);
    if (!member) {
      // Reconnecting/restarting inside the entrance must not silently opt into another match.
      if (account.body && insideArenaGate(actor)) this.mustExitGate.add(account.id);
      member = { roomId: 'world', epoch: 0, account, classId, connected: true };
      this.memberships.set(account.id, member);
    }
    member.epoch++;
    member.classId = actor.classId;
    member.connected = true;
    member.expiresAt = undefined;
    return actor;
  }

  disconnect(id: string, voluntary = false): void {
    const member = this.memberships.get(id);
    if (!member || !member.connected) return;
    member.connected = false;
    this.gateEntries.delete(id);
    this.notices.delete(id);
    if (member.roomId === 'world') {
      // Preserve the existing open-world combat-logout grace for every exit.
      this.global.disconnectPlayer(id);
      member.expiresAt = this.global.now + 20_000;
    } else if (voluntary) {
      this.returnToWorld(id);
    } else {
      member.expiresAt = this.global.now + 20_000;
      this.simulationFor(id).disconnectPlayer(id);
    }
  }

  enqueueInput(id: string, input: InputCommand, roomId: string, epoch: number): boolean {
    const member = this.membership(id);
    // In-flight packets from a previous instance are harmless, not malformed input.
    if (roomId !== member.roomId || epoch !== member.epoch) return true;
    return this.simulationFor(id).enqueueInput(id, input);
  }

  /** Trusted server API; a future queue/invitation service supplies a validated roster. */
  createMatch(mode: MatchRoom['mode'], teams: [string[], string[]], durationSeconds = 600): string {
    if (!['arena', 'battleground'].includes(mode) || !Number.isFinite(durationSeconds) || durationSeconds < 10 || durationSeconds > 1800) throw new Error('Configurazione partita non valida.');
    const maxTeam = mode === 'arena' ? 3 : 5;
    if (teams.length !== 2 || teams.some(team => !team.length || team.length > maxTeam) || teams[0].length !== teams[1].length) throw new Error('Servono due squadre valide della stessa dimensione.');
    const ids = teams.flat();
    if (new Set(ids).size !== ids.length || this.rooms.size >= 16) throw new Error('Partecipanti duplicati o limite stanze raggiunto.');
    for (const id of ids) {
      const member = this.membership(id);
      if (!member.connected || member.roomId !== 'world' || !this.global.canTransfer(id)) throw new Error('I partecipanti devono essere online nel mondo, vivi e fuori combattimento da 10 secondi.');
    }
    const id = randomUUID();
    const simulation = new WorldSimulation(this.global.seed, this.global.now, undefined, mode);
    // Prepare everything before removing any character from the global world.
    for (const [teamIndex, team] of teams.entries()) for (const [slot, playerId] of team.entries()) {
      const member = this.membership(playerId);
      const temporary: Account = { ...member.account, body: undefined, friends: [], requests: [] };
      const actor = simulation.addPlayer(temporary, member.classId);
      actor.teamId = `${id}:${teamIndex}`;
      actor.x = (teamIndex === 0 ? -1 : 1) * (mode === 'arena' ? 300 : 700);
      actor.y = mode === 'arena' ? (slot - (team.length - 1) / 2) * 70 : slot * 70 - 140;
      actor.aim = teamIndex === 0 ? 0 : Math.PI;
    }
    this.global.checkpoint();
    // Persist return positions before entering a transient instance (also on crash/restart).
    this.store?.flush();
    this.rooms.set(id, { id, mode, simulation, members: new Set(ids), endsAt: this.global.now + durationSeconds * 1000 });
    for (const playerId of ids) {
      this.global.detachPlayer(playerId);
      this.global.awayPlayers.add(playerId);
      const member = this.membership(playerId);
      member.roomId = id;
      member.epoch++;
      this.gateEntries.delete(playerId);
    }
    return id;
  }

  returnToWorld(id: string): void {
    const member = this.membership(id);
    if (member.roomId === 'world') return;
    const room = this.rooms.get(member.roomId)!;
    this.mustExitGate.add(id);
    // Reserve return capacity: create the global body before discarding the instance body.
    if (member.connected) this.global.addPlayer(member.account, member.classId);
    room.simulation.detachPlayer(id);
    room.members.delete(id);
    this.global.awayPlayers.delete(id);
    member.roomId = 'world';
    member.epoch++;
    member.expiresAt = undefined;
    if (!member.connected) this.memberships.delete(id);
    if (!room.members.size) this.rooms.delete(room.id);
  }

  closeMatch(id: string, reason: 'closed' | 'timeout' | 'elimination' = 'closed'): void {
    const room = this.rooms.get(id);
    if (!room) return;
    const survivingTeams = new Set([...room.simulation.players.values()].filter(actor => actor.hp > 0).map(actor => actor.teamId));
    for (const playerId of room.members) if (this.membership(playerId).connected) {
      const winner = survivingTeams.size === 1 && survivingTeams.has(room.simulation.players.get(playerId)?.teamId ?? null);
      this.notices.set(playerId, reason === 'timeout' ? 'Tempo scaduto: pareggio. Ritorno nel mondo.' : reason === 'elimination' ? (winner ? 'Vittoria! Ritorno nel mondo.' : 'Duello terminato. Ritorno nel mondo.') : 'Partita conclusa. Ritorno nel mondo.');
    }
    for (const playerId of [...room.members]) this.returnToWorld(playerId);
    this.rooms.delete(id);
  }

  step(dt = DT): void {
    this.global.step(dt);
    for (const room of this.rooms.values()) room.simulation.step(dt);
    for (const [id, member] of this.memberships) if (!member.connected && member.expiresAt !== undefined && member.expiresAt <= this.global.now) {
      if (member.roomId !== 'world') this.returnToWorld(id);
      else { this.memberships.delete(id); this.mustExitGate.delete(id); }
    }
    for (const room of [...this.rooms.values()]) {
      const teams = new Set([...room.simulation.players.values()].filter(actor => room.mode !== 'arena' || actor.hp > 0).map(actor => actor.teamId));
      if (this.global.now >= room.endsAt || teams.size < 2) this.closeMatch(room.id, this.global.now >= room.endsAt ? 'timeout' : 'elimination');
    }
    this.stepArenaGate();
  }

  private stepArenaGate(): void {
    for (const id of this.mustExitGate) {
      const member = this.memberships.get(id), actor = this.global.players.get(id);
      if (!member || (actor && !insideArenaGate(actor))) this.mustExitGate.delete(id);
    }
    const eligible = (id: string): boolean => {
      const member = this.memberships.get(id), actor = this.global.players.get(id);
      return !!member?.connected && member.roomId === 'world' && !!actor && insideArenaGate(actor) && !this.mustExitGate.has(id) && this.global.canTransfer(id);
    };
    for (const id of this.gateEntries.keys()) if (!eligible(id)) this.gateEntries.delete(id);
    for (const id of this.global.players.keys()) if (eligible(id) && !this.gateEntries.has(id)) this.gateEntries.set(id, this.global.now);
    if (this.gatePair && (!this.gatePair.ids.every(eligible) || this.rooms.size >= 16)) this.gatePair = undefined;
    if (!this.gatePair && this.gateEntries.size >= 2 && this.rooms.size < 16) {
      const ids = [...this.gateEntries].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([id]) => id) as [string, string];
      this.gatePair = { ids, startsAt: this.global.now + ARENA_GATE.countdownMs };
    }
    if (this.gatePair && this.global.now >= this.gatePair.startsAt) {
      const [a, b] = this.gatePair.ids;
      this.gatePair = undefined;
      this.createMatch('arena', [[a], [b]], ARENA_DURATION_SECONDS);
    }
  }

  gateStateFor(id: string): ArenaGateState | undefined {
    const member = this.membership(id), actor = this.global.players.get(id);
    if (member.roomId !== 'world' || !actor || !insideArenaGate(actor)) return undefined;
    const players = Math.min(2, this.gateEntries.size);
    if (this.mustExitGate.has(id)) return { phase: 'reenter', players };
    if (!this.global.canTransfer(id)) return { phase: 'combat', players };
    if (this.rooms.size >= 16) return { phase: 'full', players };
    if (this.gatePair?.ids.includes(id)) return { phase: 'countdown', players: 2, startsAt: this.gatePair.startsAt };
    return { phase: 'waiting', players };
  }

  snapshotFor(id: string) {
    const snapshot = this.simulationFor(id).snapshotFor(id);
    if (snapshot) {
      snapshot.arenaGate = this.gateStateFor(id);
      if (this.membership(id).roomId === 'world') snapshot.sanctuary = !inOutpost(snapshot.self) ? 'outside' : this.global.isSafeProtected(snapshot.self) ? 'safe' : 'combat';
      snapshot.matchEndsAt = this.rooms.get(this.membership(id).roomId)?.endsAt;
    }
    return snapshot;
  }

  takeNotice(id: string): string | undefined {
    const notice = this.notices.get(id);
    this.notices.delete(id);
    return notice;
  }

  socialFor(id: string): SocialState {
    const state = this.global.socialFor(id);
    const online = (playerId: string) => !!this.memberships.get(playerId)?.connected;
    state.friends = state.friends.map(friend => ({ ...friend, online: online(friend.id) }));
    if (state.team) state.team.members = state.team.members.map(member => ({ ...member, online: online(member.id) }));
    if (this.membership(id).roomId !== 'world') {
      state.nearby = [];
      state.teamInvites = [];
    }
    return state;
  }

  socialAction(id: string, action: SocialAction, targetId?: string): string {
    if (action.startsWith('team-') && (this.membership(id).roomId !== 'world' || (targetId && this.memberships.has(targetId) && this.membership(targetId).roomId !== 'world'))) throw new Error('Gestisci il gruppo dopo la partita.');
    return this.global.socialAction(id, action, targetId);
  }

  checkpoint(): void { this.global.checkpoint(); }
}
