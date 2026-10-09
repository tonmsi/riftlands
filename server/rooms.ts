import { randomUUID } from 'node:crypto';
import { DT, WORLD_SEED, levelFromXp } from '../shared/config';
import { characterFor } from './character-progress';
import { ARENA_GATE, ARENA_DURATION_SECONDS } from '../shared/arena';
import type { ClassId, InputCommand, RoomMode, RoomState, SocialState, ArenaGateState, MatchResult } from '../shared/types';
import type { Account } from './store';
import type { GameplayPersistence } from './gameplay-persistence';
import { WorldSimulation, type SocialAction } from './simulation';
import type { InteractionCommand } from '../shared/interactions';
import { INTERACTION_RANGE } from '../shared/interactions';
import { arenaOdds, type ArenaMarket, type ArenaBet, type BettingAction, type BetWin } from '../shared/betting';
import { projectActor } from '../shared/snapshot-actor';
import { WORLD_DOCUMENT } from '../shared/world-content';
import { World } from '../shared/world';
import { INSTALLED_DUNGEON_DEFINITIONS as DUNGEON_DEFINITIONS, dungeonEncounters } from '../shared/dungeons';
import { INSTALLED_BOSS_BY_ID as BOSS_BY_ID } from '../shared/bosses';
import { worldDungeons } from '../shared/world-validation';
import { collidesWorld } from '../shared/physics';
import { TILE_SIZE, PLAYER_RADIUS } from '../shared/config';
import { atWarp, mapDocument, warpPosition, WARP_FADE_MS } from '../shared/warps';
import { validInteractionCommand } from '../shared/interactions';
import type { WorldDocument, WorldWarp } from '../shared/world-schema';

type Membership = { roomId: string; epoch: number; account: Account; classId: ClassId; connected: boolean; expiresAt?: number };
export interface MatchRoom {
  closing?: boolean;
  startsAt?: number;
  market?: ArenaMarket;
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
  private readonly spectators = new Map<string, string>();
  private readonly wagerAccounts = new Map<string, Account>();
  private readonly recentBets = new Map<string, ArenaBet[]>();
  private readonly betWins = new Map<string, BetWin[]>();
  readonly interiors = new Map<string, WorldSimulation>();
  private readonly warpRequests = new Map<string, { warp: WorldWarp; readyAt: number; epoch: number; saved: boolean }>();
  private readonly warpMessages = new Map<string, Extract<import('../shared/types').ServerMessage, { type: 'warp-transition' }>>();
  private readonly warpRearm = new Set<string>();
  constructor(private readonly store?: GameplayPersistence, seed = WORLD_SEED, now = Date.now(), readonly project: WorldDocument = WORLD_DOCUMENT) {
    const world = new World(seed, 160, 'world', project, worldDungeons(project, DUNGEON_DEFINITIONS));
    this.global = new WorldSimulation(seed, now, store, 'world', { world, dungeons: world.dungeons.flatMap(dungeonEncounters), bosses: BOSS_BY_ID,
      spawn: { x: project.spawn.x * TILE_SIZE, y: project.spawn.y * TILE_SIZE } });
  }

  private interior(id: string): WorldSimulation {
    let sim = this.interiors.get(id);
    if (!sim) {
      const document = mapDocument(this.project, id), world = new World(this.global.seed, 160, 'world', document, worldDungeons(document, DUNGEON_DEFINITIONS));
      sim = new WorldSimulation(this.global.seed, this.global.now, this.store, 'world', { world, dungeons: world.dungeons.flatMap(dungeonEncounters), bosses: BOSS_BY_ID, spawn: warpPosition(document.spawn) });
      this.interiors.set(id, sim);
    }
    sim.teams.clear(); for (const [key, team] of this.global.teams) sim.teams.set(key, { ...team, members: new Set(team.members) });
    for (const actor of sim.players.values()) actor.teamId = [...sim.teams.values()].find(t => t.members.size > 1 && t.members.has(actor.id))?.id ?? null;
    return sim;
  }

  private mapId(id: string): string { const room = this.membership(id).roomId; return room.startsWith('interior:') ? room.slice(9) : 'world'; }

  private membership(id: string): Membership {
    const member = this.memberships.get(id);
    if (!member) throw new Error('Sessione non disponibile.');
    return member;
  }

  simulationFor(id: string): WorldSimulation {
    const member = this.membership(id);
    return member.roomId === 'world' ? this.global : member.roomId.startsWith('interior:') ? this.interior(member.roomId.slice(9)) : this.rooms.get(member.roomId)!.simulation;
  }

  stateFor(id: string): RoomState {
    const member = this.membership(id), sim = this.simulationFor(id);
    const watched = this.spectators.get(id);
    if (watched) return { id: watched, epoch: member.epoch, mode: 'arena', seed: this.global.seed, spectating: true };
    return { id: member.roomId, epoch: member.epoch, mode: sim.mode, seed: sim.seed, ...(member.roomId.startsWith('interior:') ? { mapId: member.roomId.slice(9) } : {}) };
  }

  connect(account: Account, classId: ClassId) {
    let member = this.memberships.get(account.id);
    if (!member && account.location) {
      if (this.project.interiors?.some(m => m.id === account.location!.mapId)) {
        member = { roomId: `interior:${account.location.mapId}`, epoch: 0, account, classId, connected: true };
        this.memberships.set(account.id, member); this.global.awayPlayers.add(account.id);
      } else {
        if (account.body) Object.assign(account.body, account.location.returnTo);
        delete account.location; this.store?.touch();
      }
    }
    if (member?.roomId !== 'world' && !member?.roomId.startsWith('interior:') && member?.expiresAt !== undefined && member.expiresAt <= this.global.now) this.returnToWorld(account.id, true);
    member = this.memberships.get(account.id);
    const sim = member ? this.simulationFor(account.id) : this.global;
    const actor = sim.addPlayer(member && member.roomId !== 'world' && !member.roomId.startsWith('interior:') ? sim.accounts.get(account.id)! : account,
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
    this.warpRearm.add(account.id);
    return actor;
  }

  disconnect(id: string, voluntary = false): void {
    this.warpRequests.delete(id); this.warpMessages.delete(id);
    this.recentBets.delete(id);
    if (this.spectators.has(id)) this.stopWatching(id);
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
    } else if (member.roomId.startsWith('interior:')) {
      this.simulationFor(id).disconnectPlayer(id);
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
    if (this.spectators.has(id)) return true;
    // In-flight packets from a previous instance are harmless, not malformed input.
    if (roomId !== member.roomId || epoch !== member.epoch) return true;
    if (this.warpRequests.has(id)) {
      const sim = this.simulationFor(id);
      if (!sim.enqueueInput(id, input)) return false;
      const connection = sim.connections.get(id)!; connection.inputs.length = 0; connection.ack = input.seq;
      return true;
    }
    if ((this.rooms.get(member.roomId)?.startsAt ?? 0) > this.global.now) {
      const sim = this.simulationFor(id);
      if (!sim.enqueueInput(id, input)) return false;
      // Consume valid countdown packets without executing them, keeping sequence and ACK aligned.
      const connection = sim.connections.get(id)!;
      connection.inputs.length = 0;
      connection.ack = input.seq;
      return true;
    }
    return this.simulationFor(id).enqueueInput(id, input);
  }
  interact(id: string, command: InteractionCommand, roomId: string, epoch: number): boolean {
    const member = this.membership(id);
    if (this.spectators.has(id)) return false;
    if (command?.kind === 'talk' && command.targetId === 'authored:npc-arena-bookmaker') return false;
    if (!member.connected || roomId !== member.roomId || epoch !== member.epoch) return false;
    if (!validInteractionCommand(command)) return false;
    if (this.warpRequests.has(id)) return false;
    if (command.kind === 'warp') {
      const warp = this.project.warps?.find(w => w.id === command.warpId && w.from === this.mapId(id) && w.activation === 'interact');
      if (!warp) throw new Error('Passaggio non disponibile.');
      this.requestWarp(id, warp); return true;
    }
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
        const temporary: Account = { ...member.account, characters: structuredClone(member.account.characters), inventory: structuredClone(member.account.inventory), narrative: structuredClone(member.account.narrative), body: undefined, friends: [], requests: [] };
        const actor = simulation.addPlayer(temporary, member.classId);
        actor.teamId = `${id}:${teamIndex}`;
        actor.x = mode === 'arena' ? (slot - (team.length - 1) / 2) * 70 : (teamIndex === 0 ? -1 : 1) * 700;
        actor.y = mode === 'arena' ? (teamIndex === 0 ? -240 : 240) : slot * 70 - 140;
        actor.aim = mode === 'arena' ? (teamIndex === 0 ? Math.PI / 2 : -Math.PI / 2) : teamIndex === 0 ? 0 : Math.PI;
      }
      this.rooms.set(id, { id, mode, simulation, members: new Set(ids), endsAt: this.global.now + durationSeconds * 1000,
        roster: new Map([...simulation.players.values()].map(actor => [actor.id, actor.teamId!])) });
      if (mode === 'arena' && ids.length === 2) {
        const room = this.rooms.get(id)!;
        room.startsAt = this.global.now + 10_000;
        room.endsAt += 10_000;
        const contenders = [...simulation.players.values()].map(p => ({ id: p.id, name: p.name, classId: p.classId, level: p.level, kills: p.kills, deaths: p.deaths, odds: 1 }));
        const odds = arenaOdds(contenders);
        contenders.forEach((p, i) => p.odds = odds[i]);
        room.market = { id, startsAt: room.startsAt, phase: 'open', contenders };
      }
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
    if (member.roomId.startsWith('interior:')) {
      const sim = this.simulationFor(id); sim.detachPlayer(id);
      if (member.account.body && member.account.location) Object.assign(member.account.body, member.account.location.returnTo);
      delete member.account.location;
      member.roomId = 'world'; member.epoch++; this.global.awayPlayers.delete(id);
      if (member.connected) this.global.addPlayer(member.account, member.classId);
      else { this.global.leaveTeam(id); this.memberships.delete(id); }
      this.store?.touch(); return;
    }
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
    if (!room.members.size && !room.closing) this.closeMatch(room.id);
  }

  closeMatch(id: string, reason: 'closed' | 'timeout' | 'elimination' = 'closed'): void {
    const room = this.rooms.get(id);
    if (!room || room.closing) return;
    room.closing = true;
    const survivingTeams = new Set([...room.simulation.players.values()].filter(actor => actor.hp > 0).map(actor => actor.teamId));
    const remainingTeams = new Set([...room.simulation.players.values()].map(actor => actor.teamId));
    const resultReason = reason === 'elimination' && remainingTeams.size < 2 ? 'forfeit' : reason;
    const winnerTeam = reason === 'elimination' && resultReason !== 'forfeit' && survivingTeams.size === 1 ? [...survivingTeams][0] : undefined;
    this.settleBets(room, winnerTeam ?? undefined);
    for (const [spectator, watched] of [...this.spectators]) if (watched === id) {
      this.stopWatching(spectator);
      this.notices.set(spectator, winnerTeam ? `Duello concluso: vince ${room.market?.contenders.find(p => room.roster.get(p.id) === winnerTeam)?.name ?? 'il vincitore'}!` : 'Duello concluso: puntate rimborsate.');
    }
    for (const playerId of room.members) {
      const winner = survivingTeams.size === 1 && survivingTeams.has(room.roster.get(playerId)!);
      this.matchResults.set(playerId, { roomId: room.id, mode: room.mode,
        outcome: reason === 'timeout' || (reason === 'elimination' && survivingTeams.size === 0) ? 'draw' : reason === 'closed' ? 'closed' : winner ? 'win' : 'loss',
        reason: resultReason });
      if (!this.memberships.get(playerId)?.connected) continue;
      this.notices.set(playerId, reason === 'timeout' ? 'Tempo scaduto: pareggio. Ritorno nel mondo.' : reason === 'elimination' ? (winner ? 'Vittoria! Ritorno nel mondo.' : 'Duello terminato. Ritorno nel mondo.') : 'Partita conclusa. Ritorno nel mondo.');
    }
    for (const playerId of [...room.members]) this.returnToWorld(playerId);
    // Reward completed battlegrounds, never arena duels, per-kill farming or forfeits.
    if (room.mode === 'battleground' && resultReason !== 'closed' && resultReason !== 'forfeit') {
      for (const [playerId, teamId] of room.roster) {
        const member = this.memberships.get(playerId);
        if (!member?.connected || !this.global.players.has(playerId)) continue;
        const winner = survivingTeams.size === 1 && survivingTeams.has(teamId);
        const xp = reason === 'timeout' || survivingTeams.size === 0 ? 100 : winner ? 150 : 75;
        this.global.awardXp(playerId, xp);
      }
    }
    this.rooms.delete(id);
  }

  step(dt = DT): void {
    this.global.step(dt);
    for (const id of this.interiors.keys()) this.interior(id).step(dt);
    for (const room of this.rooms.values()) {
      if ((room.startsAt ?? 0) > this.global.now) { room.simulation.now = this.global.now; continue; }
      if (room.market) room.market.phase = 'live';
      room.simulation.step(dt);
    }
    for (const [id, member] of this.memberships) if (!member.connected && member.expiresAt !== undefined && member.expiresAt <= this.global.now) {
      if (member.roomId.startsWith('interior:')) { this.simulationFor(id).detachPlayer(id); this.global.awayPlayers.delete(id); this.global.leaveTeam(id); this.memberships.delete(id); this.warpRearm.delete(id); }
      else if (member.roomId !== 'world') this.returnToWorld(id, true);
      else { this.memberships.delete(id); this.mustExitGate.delete(id); }
    }
    for (const room of [...this.rooms.values()]) {
      const teams = new Set([...room.simulation.players.values()].filter(actor => room.mode !== 'arena' || actor.hp > 0).map(actor => actor.teamId));
      if (this.global.now >= room.endsAt || teams.size < 2) this.closeMatch(room.id, this.global.now >= room.endsAt ? 'timeout' : 'elimination');
    }
    this.stepArenaGate();
    this.stepWarps();
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
    const watched = this.spectators.get(id);
    if (watched) {
      const room = this.rooms.get(watched)!;
      const players = [...room.simulation.players.values()];
      const focus = players.find(p => p.hp > 0) ?? players[0];
      if (!focus) return undefined;
      // Spectators have no actor in the arena, and never receive a fighter's private state.
      const sim = room.simulation;
      return { type: 'snapshot' as const, tick: sim.tick, time: this.global.now, ack: 0,
        self: projectActor(focus), actors: players.map(projectActor), projectiles: [...sim.projectiles.values()],
        pickups: [], traps: [...sim.traps.values()], events: [...sim.events], online: room.members.size,
        activeChunks: sim.activeChunks.size, gold: this.membership(id).account.gold ?? 0,
        matchEndsAt: room.endsAt, betting: this.bettingView(id) };
    }
    const snapshot = this.simulationFor(id).snapshotFor(id);
    if (snapshot) {
      snapshot.betting = this.bettingView(id);
      snapshot.gold = this.membership(id).account.gold ?? 0;
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
    if (this.spectators.has(id)) throw new Error('Esci dalla tribuna per gestire il gruppo.');
    if (action.startsWith('team-') && (this.membership(id).roomId !== 'world' || (targetId && this.memberships.has(targetId) && this.membership(targetId).roomId !== 'world'))) throw new Error('Gestisci il gruppo dopo la partita.');
    return this.global.socialAction(id, action, targetId);
  }

  bookmakerNearby(id: string): boolean {
    const actor = this.global.players.get(id), npc = this.global.npcs.get('authored:npc-arena-bookmaker');
    return !!actor && !!npc && Math.hypot(actor.x - npc.x, actor.y - npc.y) <= INTERACTION_RANGE;
  }

  private requestWarp(id: string, warp: WorldWarp): void {
    const member = this.membership(id), sim = this.simulationFor(id), actor = sim.players.get(id);
    if (this.transfersStopped || this.pendingPlayers.has(id) || this.warpRequests.has(id) || this.spectators.has(id)
      || !member.connected || sim.mode !== 'world' || !actor || actor.hp <= 0 || !atWarp(actor, warp) || this.mapId(id) !== warp.from)
      throw new Error('Avvicinati al passaggio per attraversarlo.');
    if (this.warpRearm.has(id)) throw new Error('Allontanati dalla porta e rientra per attraversarla di nuovo.');
    if (sim.fishing.busy(id)) throw new Error('Ritira la lenza prima di attraversare.');
    if (Math.max(sim.connections.get(id)?.combatUntil ?? 0, actor.pvpUntil ?? 0) > sim.now
      || [...sim.bosses.values()].some(b => b.participantIds.has(id) && b.ownerId)) throw new Error('Non puoi attraversare durante un combattimento.');
    const target = warp.to === 'world' ? this.global : this.interior(warp.to), arrival = warpPosition(warp.arrival);
    if (collidesWorld(arrival.x, arrival.y, PLAYER_RADIUS + 2, target.world)) throw new Error('Arrivo del passaggio bloccato.');
    sim.checkpoint(); this.store?.flush();
    sim.interactions.close(id); sim.fishing.close(id); sim.connections.get(id)!.inputs.length = 0;
    const request = { warp, readyAt: this.global.now + WARP_FADE_MS + 80, epoch: member.epoch, saved: !this.store };
    this.warpRequests.set(id, request);
    if (this.store) void this.store.drain().then(() => { request.saved = true; }).catch(error => {
      if (this.warpRequests.get(id) !== request) return;
      this.warpRequests.delete(id); this.warpRearm.add(id);
      this.warpMessages.set(id, { type: 'warp-transition', phase: 'cancel' });
      this.notices.set(id, `Passaggio annullato: ${(error as Error).message}`);
    });
    this.warpMessages.set(id, { type: 'warp-transition', phase: 'start', name: warp.name });
  }

  private stepWarps(): void {
    for (const [id, member] of this.memberships) {
      if (!member.connected || this.spectators.has(id) || this.simulationFor(id).mode !== 'world') continue;
      const actor = this.simulationFor(id).players.get(id); if (!actor) continue;
      const nearby = (this.project.warps ?? []).filter(w => w.from === this.mapId(id) && atWarp(actor, w));
      if (this.warpRearm.has(id)) { if (!nearby.length) this.warpRearm.delete(id); continue; }
      if (!this.warpRequests.has(id)) {
        const warp = nearby.find(w => w.activation === 'walk');
        if (warp && actor.hp > 0 && !this.simulationFor(id).fishing.busy(id)) {
          try { this.requestWarp(id, warp); } catch (e) { this.notices.set(id, (e as Error).message); this.warpRearm.add(id); }
        }
      }
    }
    for (const [id, request] of this.warpRequests) if (request.saved && this.global.now >= request.readyAt) {
      this.warpRequests.delete(id);
      const member = this.memberships.get(id); if (!member?.connected) continue;
      const source = this.simulationFor(id), actor = source.players.get(id), { warp } = request;
      if (this.transfersStopped || member.epoch !== request.epoch || !actor || actor.hp <= 0 || !atWarp(actor, warp)
        || Math.max(source.connections.get(id)?.combatUntil ?? 0, actor.pvpUntil ?? 0) > source.now) {
        this.warpRearm.add(id); this.notices.set(id, 'Passaggio interrotto.');
        this.warpMessages.set(id, { type: 'warp-transition', phase: 'cancel' }); continue;
      }
      const target = warp.to === 'world' ? this.global : this.interior(warp.to), arrival = warpPosition(warp.arrival);
      const oldBody = structuredClone(actor), oldLocation = member.account.location;
      try {
        if (collidesWorld(arrival.x, arrival.y, PLAYER_RADIUS + 2, target.world)) throw new Error('Arrivo bloccato.');
        source.detachPlayer(id);
        Object.assign(member.account.body!, arrival);
        if (warp.to === 'world') delete member.account.location;
        else member.account.location = { mapId: warp.to, returnTo: oldLocation?.returnTo ?? { x: oldBody.x, y: oldBody.y } };
        target.addPlayer(member.account, member.classId);
        member.roomId = warp.to === 'world' ? 'world' : `interior:${warp.to}`; member.epoch++;
        if (warp.to === 'world') this.global.awayPlayers.delete(id); else this.global.awayPlayers.add(id);
        target.checkpoint(); this.store?.touch(); this.store?.flush(); this.warpRearm.add(id);
      } catch (error) {
        if (target.players.has(id)) target.detachPlayer(id);
        member.account.body = oldBody; member.account.location = oldLocation;
        member.roomId = warp.from === 'world' ? 'world' : `interior:${warp.from}`;
        source.addPlayer(member.account, member.classId); member.epoch++;
        if (warp.from === 'world') this.global.awayPlayers.delete(id); else this.global.awayPlayers.add(id);
        this.store?.touch(); this.warpRearm.add(id);
        this.notices.set(id, `Passaggio annullato: ${(error as Error).message}`);
        this.warpMessages.set(id, { type: 'warp-transition', phase: 'cancel' });
      }
    }
  }

  takeWarpTransition(id: string) { const message = this.warpMessages.get(id); this.warpMessages.delete(id); return message; }

  private bettingView(id: string) {
    const member = this.membership(id), watched = this.spectators.get(id);
    let bets = this.recentBets.get(id);
    if (!bets) {
      const history = member.account.arenaBets ?? [], active: ArenaBet[] = [], recent: ArenaBet[] = [];
      for (let i = history.length - 1; i >= 0; i--) {
        const bet = history[i];
        if (bet.status === 'active') active.push(bet);
        else if (recent.length < 10) recent.push(bet);
      }
      bets = [...active, ...recent]; this.recentBets.set(id, bets);
    }
    return { markets: [...this.rooms.values()].flatMap(r => r.market ? [r.market] : []),
      bets, inCombat: this.bettingInCombat(id), bookmakerNearby: !watched && member.roomId === 'world' && this.bookmakerNearby(id),
      canWatch: this.canWatchArena(id), spectating: watched, startsAt: this.rooms.get(watched ?? member.roomId)?.startsAt };
  }
  private canWatchArena(id: string): boolean {
    const member = this.membership(id);
    return (this.global.players.get(id)?.level ?? levelFromXp(characterFor(member.account, member.classId).xp)) >= 20;
  }

  bettingAction(id: string, action: BettingAction): void {
    const member = this.membership(id);
    if (!member.connected || !action || typeof action !== 'object') throw new Error('Richiesta non valida.');
    if (action.kind === 'exit') { this.stopWatching(id); return; }
    const room = this.rooms.get(action.matchId);
    if (!room?.market || room.members.has(id)) throw new Error('Duello non disponibile per questa azione.');
    if (action.kind === 'watch') {
      if (!this.canWatchArena(id)) throw new Error('La tribuna delle arene si sblocca al livello 20.');
      if (this.spectators.has(id)) this.stopWatching(id);
      if (member.roomId !== 'world' || !this.global.canTransfer(id)) throw new Error('Devi essere vivo e fuori combattimento da 10 secondi.');
      this.global.checkpoint(); this.global.detachPlayer(id); this.global.awayPlayers.add(id);
      this.spectators.set(id, room.id); this.mustExitGate.add(id); member.epoch++;
      return;
    }
    if (action.kind !== 'bet' || this.spectators.has(id) || member.roomId !== 'world' || !this.bookmakerNearby(id)) throw new Error('Avvicinati a Silas per scommettere.');
    if (this.global.now >= room.market.startsAt) throw new Error('Puntate chiuse: il duello è iniziato.');
    const contender = room.market.contenders.find(p => p.id === action.playerId);
    if (!contender || !Number.isSafeInteger(action.stake) || action.stake < 1 || action.stake > 10000) throw new Error('Puntata non valida (1–10.000 gold).');
    const account = member.account;
    if (account.arenaBets?.some(b => b.matchId === room.id)) throw new Error('Hai già puntato su questo duello.');
    if ((account.gold ?? 0) < action.stake) throw new Error('Gold insufficienti.');
    account.gold = (account.gold ?? 0) - action.stake;
    (account.arenaBets ??= []).push({ id: randomUUID(), matchId: room.id, playerId: contender.id, playerName: contender.name, stake: action.stake, odds: contender.odds, payout: 0, status: 'active', placedAt: this.global.now });
    this.recentBets.delete(id);
    this.wagerAccounts.set(id, account); this.store?.touch();
    this.notices.set(id, `Puntata accettata: ${action.stake} gold su ${contender.name}, quota ${contender.odds.toFixed(2)}.`);
  }

  private stopWatching(id: string): void {
    if (!this.spectators.delete(id)) return;
    const member = this.membership(id);
    this.global.awayPlayers.delete(id); this.global.addPlayer(member.account, member.classId); member.epoch++;
  }

  private settleBets(room: MatchRoom, winnerTeam?: string): void {
    for (const account of this.wagerAccounts.values()) for (const bet of account.arenaBets ?? []) {
      if (bet.matchId !== room.id || bet.status !== 'active') continue;
      bet.status = !winnerTeam ? 'refunded' : room.roster.get(bet.playerId) === winnerTeam ? 'won' : 'lost';
      bet.payout = bet.status === 'refunded' ? bet.stake : bet.status === 'won' ? Math.floor(bet.stake * bet.odds) : 0;
      account.gold = (account.gold ?? 0) + bet.payout; this.store?.touch();
      this.recentBets.delete(account.id);
      if (bet.status === 'won' && this.memberships.get(account.id)?.connected) {
        const wins = this.betWins.get(account.id) ?? [];
        wins.push({ id: bet.id, amount: bet.payout, celebrate: !this.bettingInCombat(account.id) });
        this.betWins.set(account.id, wins);
      }
      this.notices.set(account.id, bet.status === 'won' ? `Scommessa vinta! +${bet.payout} gold.` : bet.status === 'refunded' ? `Scommessa rimborsata: ${bet.stake} gold.` : 'Scommessa persa.');
    }
    for (const [id, account] of this.wagerAccounts) if (!account.arenaBets?.some(b => b.status === 'active')) this.wagerAccounts.delete(id);
    this.store?.flush();
  }

  checkpoint(): void { this.global.checkpoint(); for (const sim of this.interiors.values()) sim.checkpoint(); }
  private bettingInCombat(id: string): boolean {
    const member = this.memberships.get(id);
    if (!member || this.spectators.has(id)) return false;
    if (member.roomId !== 'world') return true;
    return Math.max(this.global.connections.get(id)?.combatUntil ?? 0, this.global.players.get(id)?.pvpUntil ?? 0) > this.global.now;
  }
  takeBetWins(id: string): BetWin[] {
    const wins = this.betWins.get(id) ?? []; this.betWins.delete(id); return wins;
  }
}
