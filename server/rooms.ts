import { randomUUID } from 'node:crypto';
import { DT, WORLD_SEED } from '../shared/config';
import { ARENA_GATE, ARENA_DURATION_SECONDS } from '../shared/arena';
import type { ClassId, InputCommand, RoomMode, RoomState, SocialState, ArenaGateState, MatchResult } from '../shared/types';
import type { Account } from './store';
import type { GameplayPersistence } from './gameplay-persistence';
import { WorldSimulation, type SocialAction } from './simulation';
import type { InteractionCommand } from '../shared/interactions';

type Membership = { roomId: string; epoch: number; account: Account; classId: ClassId; connected: boolean; expiresAt?: number };
export interface MatchRoom {
  id: string;
  mode: Exclude<RoomMode, 'world'>;
  simulation: WorldSimulation;
  members: Set<string>;
  endsAt: number;
  roster: Map<string, string>;
}

/** One owner for routing and persistent characters. Match accounts are disposable copies. */
export class RoomManager {
  readonly global: WorldSimulation;
  readonly rooms = new Map<string, MatchRoom>();
  private readonly memberships = new Map<string, Membership>();
  private readonly gateEntries = new Map<string, number>();
  private readonly mustExitGate = new Set<string>();
  private gatePairs = new Map<string, { ids: [string, string]; startsAt: number; saving?: boolean }>();
  private readonly pendingPlayers = new Set<string>();
  private pendingMatches = 0;
  private transfersStopped = false;
  private readonly notices = new Map<string, string>();
  private readonly matchResults = new Map<string, MatchResult>();
  constructor(private readonly store?: GameplayPersistence, seed = WORLD_SEED, now = Date.now()) {
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
    if (member?.roomId !== 'world' && member?.expiresAt !== undefined && member.expiresAt <= this.global.now) this.returnToWorld(account.id, true);
    member = this.memberships.get(account.id);
    const sim = member ? this.simulationFor(account.id) : this.global;
    const actor = sim.addPlayer(member && member.roomId !== 'world' ? sim.accounts.get(account.id)! : account,
      member && member.roomId !== 'world' ? member.classId : classId);
    if (!member) {
      // Reconnecting/restarting inside the entrance must not silently opt into another match.
      if (account.body && this.global.world.arenaAt(actor.x, actor.y)) this.mustExitGate.add(account.id);
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
    if (voluntary) this.global.leaveTeam(id);
    this.gateEntries.delete(id);
    this.notices.delete(id);
    if (member.roomId === 'world') {
      // Preserve the existing open-world combat-logout grace for every exit.
      this.global.disconnectPlayer(id);
      member.expiresAt = this.global.now + 20_000;
    } else if (voluntary) {
      this.returnToWorld(id, true);
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
  interact(id: string, command: InteractionCommand, roomId: string, epoch: number): boolean {
    const member = this.membership(id);
    if (!member.connected || roomId !== member.roomId || epoch !== member.epoch) return false;
    this.simulationFor(id).interact(id, command); return true;
  }

  /** Trusted server API; a future queue/invitation service supplies a validated roster. */
  createMatch(mode: MatchRoom['mode'], teams: [string[], string[]], durationSeconds = 600): Promise<string> {
    return this.startMatch(mode, teams, durationSeconds);
  }

  private async startMatch(mode: MatchRoom['mode'], teams: [string[], string[]], durationSeconds: number, admission = () => true): Promise<string> {
    if (!['arena', 'battleground'].includes(mode) || !Number.isFinite(durationSeconds) || durationSeconds < 10 || durationSeconds > 1800) throw new Error('Configurazione partita non valida.');
    const maxTeam = mode === 'arena' ? 3 : 5;
    if (teams.length !== 2 || teams.some(team => !team.length || team.length > maxTeam) || teams[0].length !== teams[1].length) throw new Error('Servono due squadre valide della stessa dimensione.');
    const roster = teams.map(team => [...team]);
    const ids = roster.flat();
    if (this.transfersStopped || new Set(ids).size !== ids.length || this.rooms.size + this.pendingMatches >= 16 || ids.some(id => this.pendingPlayers.has(id))) throw new Error('Partecipanti duplicati o limite stanze raggiunto.');
    for (const id of ids) {
      const member = this.membership(id);
      if (!member.connected || member.roomId !== 'world' || !this.global.canTransfer(id)) throw new Error('I partecipanti devono essere online nel mondo, vivi e fuori combattimento da 10 secondi.');
    }
    const epochs = ids.map(id => this.membership(id).epoch);
    this.pendingMatches++;
    for (const playerId of ids) this.pendingPlayers.add(playerId);
    try {
      this.global.checkpoint();
      // Persist return positions before entering a transient instance (also on crash/restart).
      this.store?.flush();
      if (this.store) await this.store.drain();
      if (this.transfersStopped || !admission() || ids.some((playerId, i) => {
        const member = this.memberships.get(playerId);
        return !member?.connected || member.roomId !== 'world' || member.epoch !== epochs[i] || !this.global.canTransfer(playerId);
      })) throw new Error('Ingresso annullato: i partecipanti non sono più disponibili.');
      const id = randomUUID();
      const simulation = new WorldSimulation(this.global.seed, this.global.now, undefined, mode);
      // Prepare everything before removing any character from the global world.
      for (const [teamIndex, team] of roster.entries()) for (const [slot, playerId] of team.entries()) {
        const member = this.membership(playerId);
        const temporary: Account = { ...member.account, inventory: structuredClone(member.account.inventory), narrative: structuredClone(member.account.narrative), body: undefined, friends: [], requests: [] };
        const actor = simulation.addPlayer(temporary, member.classId);
        actor.teamId = `${id}:${teamIndex}`;
        actor.x = mode === 'arena' ? (slot - (team.length - 1) / 2) * 70 : (teamIndex === 0 ? -1 : 1) * 700;
        actor.y = mode === 'arena' ? (teamIndex === 0 ? -240 : 240) : slot * 70 - 140;
        actor.aim = mode === 'arena' ? (teamIndex === 0 ? Math.PI / 2 : -Math.PI / 2) : teamIndex === 0 ? 0 : Math.PI;
      }
      this.rooms.set(id, { id, mode, simulation, members: new Set(ids), endsAt: this.global.now + durationSeconds * 1000,
        roster: new Map([...simulation.players.values()].map(actor => [actor.id, actor.teamId!])) });
      for (const playerId of ids) {
        this.global.detachPlayer(playerId);
        this.global.awayPlayers.add(playerId);
        const member = this.membership(playerId);
        member.roomId = id;
        member.epoch++;
        this.matchResults.delete(playerId);
        this.gateEntries.delete(playerId);
      }
      return id;
    } finally {
      this.pendingMatches--;
      for (const playerId of ids) this.pendingPlayers.delete(playerId);
    }
  }

  stopTransfers(): void { this.transfersStopped = true; }

  returnToWorld(id: string, forfeit = false): void {
    const member = this.membership(id);
    if (member.roomId === 'world') return;
    const room = this.rooms.get(member.roomId)!;
    if (forfeit) this.matchResults.set(id, { roomId: room.id, mode: room.mode, outcome: 'loss', reason: 'forfeit' });
    this.mustExitGate.add(id);
    // Reserve return capacity: create the global body before discarding the instance body.
    if (member.connected) this.global.addPlayer(member.account, member.classId);
    room.simulation.detachPlayer(id);
    room.members.delete(id);
    this.global.awayPlayers.delete(id);
    member.roomId = 'world';
    member.epoch++;
    member.expiresAt = undefined;
    if (!member.connected) { this.global.leaveTeam(id); this.memberships.delete(id); }
    if (!room.members.size) this.rooms.delete(room.id);
  }

  closeMatch(id: string, reason: 'closed' | 'timeout' | 'elimination' = 'closed'): void {
    const room = this.rooms.get(id);
    if (!room) return;
    const survivingTeams = new Set([...room.simulation.players.values()].filter(actor => actor.hp > 0).map(actor => actor.teamId));
    const remainingTeams = new Set([...room.simulation.players.values()].map(actor => actor.teamId));
    const resultReason = reason === 'elimination' && remainingTeams.size < 2 ? 'forfeit' : reason;
    for (const playerId of room.members) {
      const winner = survivingTeams.size === 1 && survivingTeams.has(room.roster.get(playerId)!);
      this.matchResults.set(playerId, { roomId: room.id, mode: room.mode,
        outcome: reason === 'timeout' || (reason === 'elimination' && survivingTeams.size === 0) ? 'draw' : reason === 'closed' ? 'closed' : winner ? 'win' : 'loss',
        reason: resultReason });
      if (!this.memberships.get(playerId)?.connected) continue;
      this.notices.set(playerId, reason === 'timeout' ? 'Tempo scaduto: pareggio. Ritorno nel mondo.' : reason === 'elimination' ? (winner ? 'Vittoria! Ritorno nel mondo.' : 'Duello terminato. Ritorno nel mondo.') : 'Partita conclusa. Ritorno nel mondo.');
    }
    for (const playerId of [...room.members]) this.returnToWorld(playerId);
    this.rooms.delete(id);
  }

  step(dt = DT): void {
    this.global.step(dt);
    for (const room of this.rooms.values()) room.simulation.step(dt);
    for (const [id, member] of this.memberships) if (!member.connected && member.expiresAt !== undefined && member.expiresAt <= this.global.now) {
      if (member.roomId !== 'world') this.returnToWorld(id, true);
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
      if (!member || (actor && !this.global.world.arenaAt(actor.x, actor.y))) this.mustExitGate.delete(id);
    }
    const eligible = (id: string): boolean => {
      const member = this.memberships.get(id), actor = this.global.players.get(id);
      return !!member?.connected && member.roomId === 'world' && !!actor && !!this.global.world.arenaAt(actor.x, actor.y) && !this.mustExitGate.has(id) && this.global.canTransfer(id);
    };
    for (const id of this.gateEntries.keys()) if (!eligible(id)) this.gateEntries.delete(id);
    for (const id of this.global.players.keys()) if (eligible(id) && !this.gateEntries.has(id)) this.gateEntries.set(id, this.global.now);
    const entranceFor = (id: string) => { const actor = this.global.players.get(id)!; return this.global.world.arenaAt(actor.x, actor.y)!; };
    for (const [entrance, pair] of this.gatePairs) if (this.rooms.size >= 16 || !pair.ids.every(id => eligible(id) && entranceFor(id) === entrance)) this.gatePairs.delete(entrance);
    const queues = new Map<string, [string, number][]>();
    for (const entry of this.gateEntries) {
      if (this.pendingPlayers.has(entry[0])) continue;
      const entrance = entranceFor(entry[0]), queue = queues.get(entrance) ?? []; queue.push(entry); queues.set(entrance, queue);
    }
    for (const [entrance, queue] of queues) if (!this.gatePairs.has(entrance) && queue.length >= 2 && this.rooms.size + this.gatePairs.size < 16) {
      const ids = queue.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([id]) => id) as [string, string];
      this.gatePairs.set(entrance, { ids, startsAt: this.global.now + ARENA_GATE.countdownMs });
    }
    for (const [entrance, pair] of this.gatePairs) if (!pair.saving && this.global.now >= pair.startsAt && this.rooms.size + this.pendingMatches < 16) {
      pair.saving = true;
      void this.startMatch('arena', [[pair.ids[0]], [pair.ids[1]]], ARENA_DURATION_SECONDS,
        () => this.gatePairs.get(entrance) === pair && pair.ids.every(id => eligible(id) && entranceFor(id) === entrance))
        .catch(error => {
          for (const id of pair.ids) if (this.memberships.get(id)?.connected) this.notices.set(id, error instanceof Error ? error.message : 'Ingresso non riuscito.');
        }).finally(() => { if (this.gatePairs.get(entrance) === pair) this.gatePairs.delete(entrance); });
    }
  }

  gateStateFor(id: string): ArenaGateState | undefined {
    const member = this.membership(id), actor = this.global.players.get(id);
    if (member.roomId !== 'world' || !actor) return undefined;
    const entrance = this.global.world.arenaAt(actor.x, actor.y);
    if (!entrance) return undefined;
    const players = Math.min(2, [...this.gateEntries.keys()].filter(id => { const a = this.global.players.get(id)!; return this.global.world.arenaAt(a.x, a.y) === entrance; }).length);
    if (this.mustExitGate.has(id)) return { phase: 'reenter', players };
    if (!this.global.canTransfer(id)) return { phase: 'combat', players };
    if (this.rooms.size >= 16) return { phase: 'full', players };
    const pair = this.gatePairs.get(entrance);
    if (pair?.ids.includes(id)) return { phase: 'countdown', players: 2, startsAt: pair.startsAt };
    return { phase: 'waiting', players };
  }

  snapshotFor(id: string) {
    const snapshot = this.simulationFor(id).snapshotFor(id);
    if (snapshot) {
      snapshot.arenaGate = this.gateStateFor(id);
      if (this.membership(id).roomId === 'world') snapshot.sanctuary = this.global.world.pvpAt(snapshot.self.x, snapshot.self.y) ? 'outside' : this.global.isSafeProtected(snapshot.self) ? 'safe' : 'combat';
      snapshot.matchEndsAt = this.rooms.get(this.membership(id).roomId)?.endsAt;
    }
    return snapshot;
  }

  takeNotice(id: string): string | undefined {
    const notice = this.notices.get(id);
    this.notices.delete(id);
    return notice;
  }
  takeMatchResult(id: string): MatchResult | undefined {
    const result = this.matchResults.get(id);
    this.matchResults.delete(id);
    return result;
  }

  socialFor(id: string): SocialState {
    const state = this.global.socialFor(id);
    const online = (playerId: string) => !!this.memberships.get(playerId)?.connected;
    state.friends = state.friends.map(friend => ({ ...friend, online: online(friend.id) }));
    if (state.team) state.team.members = state.team.members.map(member => {
      const actor = this.memberships.has(member.id) ? this.simulationFor(member.id).players.get(member.id) : undefined;
      return { ...member, online: online(member.id), hp: actor?.hp, maxHp: actor?.maxHp };
    });
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
