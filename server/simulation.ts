import { sweptWorldHit } from '../shared/projectiles';
export { sweptWorldHit } from '../shared/projectiles';
import { randomUUID } from '../shared/id';
import { CLASSES, DT, INTEREST_RADIUS, PLAYER_RADIUS, TILE_SIZE, WORLD_SEED, levelFromXp } from '../shared/config';
import { collidesWorld, hasLineOfSight, moveWithCollisions, movementSpeed, resolveActorCollisions, segmentCircleHit, terrainSpeed } from '../shared/physics';
import { playerSpriteDirectionRow } from '../shared/sprite-direction';
import type { AbilitySlot, Actor, ClassId, ClientMessage, GameEvent, InputCommand, Pickup, Projectile, Snapshot, SocialState, Trap, Vec2, RoomMode } from '../shared/types';
import { World, chunkCoords, chunkKey } from '../shared/world';
import { OUTPOST, inOutpost } from '../shared/outpost';
import { insideArenaGate } from '../shared/arena';
import { BOSS_BY_ID, type BossDefinition } from '../shared/bosses';
import { DUNGEON_BY_BOSS_ID, type DungeonDefinition } from '../shared/dungeons';
import { NPC_CATALOG } from '../shared/npcs';
import { BossEncounter } from './boss-encounter';
import type { Account, AccountStore } from './store';

const EMPTY_COOLDOWNS = () => ({ basic: 0, q: 0, e: 0, r: 0 });
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const copyActor = (actor: Actor): Actor => ({ ...actor, effects: actor.effects.map(effect => ({ ...effect })), cooldowns: { ...actor.cooldowns } });
type Connection = { account: Account; connected: boolean; removeAt: number; inputs: InputCommand[]; ack: number; highestSeq: number; combatAt: number };
type NpcMeta = { home: Vec2; chunk: string; nextAttack: number };
type ActiveChunk = { key: string; lastUsed: number; npcIds: string[]; pickupIds: string[] };
type Team = { id: string; leaderId: string; members: Set<string> };
type Invite = { fromId: string; teamId: string; expiresAt: number };
export interface SimulationEnvironment {
  world: World;
  dungeons: readonly DungeonDefinition[];
  bosses: ReadonlyMap<string, BossDefinition>;
  spawn: Vec2;
}
export type SocialAction = Extract<ClientMessage, { type: 'social' }>['action'];

/** Single authoritative simulation. Time fields are milliseconds; step delta is seconds. */
export class WorldSimulation {
  readonly bosses = new Map<string, BossEncounter>();
  readonly world: World;
  readonly seed: number;
  readonly players = new Map<string, Actor>();
  readonly npcs = new Map<string, Actor>();
  readonly projectiles = new Map<string, Projectile>();
  readonly pickups = new Map<string, Pickup>();
  readonly accounts = new Map<string, Account>();
  readonly connections = new Map<string, Connection>();
  readonly teams = new Map<string, Team>();
  readonly awayPlayers = new Set<string>();
  readonly activeChunks = new Map<string, ActiveChunk>();
  readonly npcMeta = new Map<string, NpcMeta>();
  readonly events: GameEvent[] = [];
  readonly traps = new Map<string, Trap>();
  private readonly queuedBursts: {
    ownerId: string;
    remainingShots: number;
    intervalMs: number;
    nextShotAt: number;
    currentAngle: number;
    angleStep: number;
    speed: number;
    damage: number;
    radius: number;
    range: number;
    color: string;
  }[] = [];
  private readonly invites = new Map<string, Invite[]>();
  private readonly npcSleep = new Map<string, { body: Actor; nextAttack: number; until: number }>();
  private readonly pickupReady = new Map<string, number>();
  private readonly cells = new Map<string, Actor[]>();
  private largestActorRadius = PLAYER_RADIUS;
  private readonly projectileTeams = new Map<string, string | null>();
  private readonly store?: AccountStore;
  tick = 0;
  now: number;

  constructor(seed = WORLD_SEED, now = Date.now(), store?: AccountStore, readonly mode: RoomMode = 'world', private readonly environment?: SimulationEnvironment) {
    this.seed = seed;
    this.world = environment?.world ?? new World(seed, 160, mode);
    this.now = now;
    this.store = store;
    if (store) for (const account of store.accounts.values()) this.accounts.set(account.id, account);
    if (mode === 'world') {
      for (const dungeon of environment?.dungeons ?? DUNGEON_BY_BOSS_ID.values()) {
        const definition = (environment?.bosses ?? BOSS_BY_ID).get(dungeon.bossId);
        if (!definition || definition.dungeonId !== dungeon.id) throw new Error(`Configurazione dungeon non valida: ${dungeon.id}`);
        const encounter = new BossEncounter(definition, now, store?.bossStates[definition.id], store, dungeon);
        this.bosses.set(definition.id, encounter);
        this.npcs.set(encounter.boss.id, encounter.boss);
        if (store) store.bossStates[definition.id] = encounter.state;
      }
      const groups = new Map<string, BossEncounter[]>();
      for (const encounter of this.bosses.values()) if (encounter.dungeon.encounterGroupId) {
        const key = `${encounter.dungeon.id}:${encounter.dungeon.encounterGroupId}`;
        const members = groups.get(key) ?? []; members.push(encounter); groups.set(key, members);
      }
      for (const group of groups.values()) BossEncounter.linkGroup(group);
    }
  }

  get online(): number { return [...this.connections.values()].filter(connection => connection.connected).length; }

  addPlayer(account: Account, classId: ClassId): Actor {
    const current = this.players.get(account.id);
    this.accounts.set(account.id, account);
    if (current) {
      current.name = account.name;
      if (current.classId !== classId) {
        const spec = CLASSES[classId];
        current.hp = Math.min(spec.maxHp, current.hp / current.maxHp * spec.maxHp);
        current.classId = classId;
        current.maxHp = spec.maxHp;
        current.maxResource = spec.maxResource;
        current.resource = 0;
        current.speed = spec.speed;
      }
      const connection = this.connections.get(account.id)!;
      connection.connected = true;
      connection.removeAt = 0;
      connection.inputs = [];
      connection.ack = 0;
      connection.highestSeq = 0;
      return current;
    }
    if (this.players.size + this.awayPlayers.size - Number(this.awayPlayers.has(account.id)) >= 128) throw new Error('Il mondo ha raggiunto il limite di 128 giocatori.');
    const spec = CLASSES[classId];
    const saved = account.body;
    const spawn = this.safeSpawn(account.id);
    const validSaved = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Math.abs(saved.x) < 1e9 && Math.abs(saved.y) < 1e9 && Number.isFinite(saved.hp) && saved.maxHp > 0;
    // Preserve health fraction, resource and cooldowns across reconnections/class changes.
    const sameClass = validSaved && saved.classId === classId;
    const player: Actor = {
      id: account.id, kind: 'player', name: account.name, classId,
      x: validSaved ? saved.x : spawn.x, y: validSaved ? saved.y : spawn.y,
      radius: PLAYER_RADIUS, hp: validSaved ? Math.max(0, Math.min(spec.maxHp, spec.maxHp * saved.hp / saved.maxHp)) : spec.maxHp,
      maxHp: spec.maxHp, resource: validSaved ? (sameClass ? Math.min(spec.maxResource, saved.resource) : 0) : (spec.resource === 'mana' ? spec.maxResource : 0),
      maxResource: spec.maxResource, aim: 0, speed: spec.speed, level: levelFromXp(account.xp), xp: account.xp,
      spriteRow: 0, spriteMoving: false,
      kills: account.kills, deaths: account.deaths, teamId: (this.teamFor(account.id)?.members.size ?? 0) > 1 ? this.teamFor(account.id)!.id : null,
      hidden: false, revealedUntil: 0, deadUntil: validSaved ? saved.deadUntil : 0,
      spawnProtectedUntil: validSaved ? saved.spawnProtectedUntil : this.now + 5000,
      pvpUntil: validSaved ? saved.pvpUntil ?? 0 : 0,
      effects: validSaved ? saved.effects.filter(effect => effect.until > this.now).map(effect => ({ ...effect })) : [],
      cooldowns: validSaved ? { ...saved.cooldowns } : EMPTY_COOLDOWNS(),
    };
    if (collidesWorld(player.x, player.y, player.radius, this.world)) Object.assign(player, spawn);
    if (this.mode === 'world' && !inOutpost(player)) player.spawnProtectedUntil = 0;
    if (player.hp <= 0 && player.deadUntil <= 0) player.deadUntil = this.now + 5000;
    this.players.set(player.id, player);
    this.connections.set(player.id, { account, connected: true, removeAt: 0, inputs: [], ack: 0, highestSeq: 0, combatAt: this.now });
    this.updateChunks();
    this.rebuildCells();
    return player;
  }

  disconnectPlayer(id: string): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    connection.connected = false;
    connection.removeAt = this.now + 20_000;
    connection.inputs = [];
    this.persistPlayer(id);
  }

  canTransfer(id: string): boolean {
    const actor = this.players.get(id), connection = this.connections.get(id);
    return !!actor && actor.hp > 0 && !!connection?.connected && this.now - connection.combatAt >= 10_000;
  }

  isSafeProtected(actor: Actor): boolean {
    return this.mode === 'world' && actor.kind === 'player' && inOutpost(actor) && (actor.pvpUntil ?? 0) <= this.now;
  }

  /** Transfer is distinct from logout: no old body or owned attack may remain. */
  detachPlayer(id: string): void {
    this.persistPlayer(id);
    this.players.delete(id);
    this.connections.delete(id);
    this.pendingCasts.delete(id);
    for (const [key, projectile] of this.projectiles) if (projectile.ownerId === id) {
      this.projectiles.delete(key);
      this.projectileTeams.delete(key);
    }
    for (const [key, trap] of this.traps) if (trap.ownerId === id) this.traps.delete(key);
    for (let i = this.queuedBursts.length - 1; i >= 0; i--) if (this.queuedBursts[i].ownerId === id) this.queuedBursts.splice(i, 1);
    this.rebuildCells();
  }

  enqueueInput(id: string, input: InputCommand): boolean {
    const connection = this.connections.get(id);
    if (input.autoAim !== undefined && typeof input.autoAim !== 'boolean') return false;
    if (input.analogMovement !== undefined && typeof input.analogMovement !== 'boolean') return false;
    if (input.targetId !== undefined && (typeof input.targetId !== 'string' || input.targetId.length > 80 || !input.targetId.length)) return false;
    if (!connection?.connected || !Number.isSafeInteger(input.seq) || input.seq <= connection.highestSeq || input.seq > connection.highestSeq + 120 || ![input.dx, input.dy, input.aim].every(Number.isFinite) || Math.abs(input.dx) > 1 || Math.abs(input.dy) > 1 || Math.abs(input.aim) > 1e6 || (input.cast !== undefined && !['basic', 'q', 'e', 'r'].includes(input.cast))) return false;
    connection.highestSeq = input.seq;
    if (connection.inputs.length >= 6) connection.inputs.shift();
    connection.inputs.push({ ...input });
    return true;
  }

  step(dt = DT): void {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw new Error('Passo simulazione non valido');
    this.now += dt * 1000;
    this.tick++;
    if (this.tick % 15 === 1) this.updateChunks();
    for (const [id, actor] of this.players) {
      const connection = this.connections.get(id)!;
      if (!connection.connected && this.now >= connection.removeAt) {
        for (const encounter of this.bosses.values()) if (encounter.isActiveParticipant(id) && actor.hp > 0) this.damage(actor, encounter.boss, Number.MAX_SAFE_INTEGER);
        this.persistPlayer(id);
        this.players.delete(id);
        this.connections.delete(id);
        this.leaveTeam(id);
        continue;
      }
      actor.effects = actor.effects.filter(effect => effect.until > this.now);
      const input = connection.inputs.shift();
      actor.spriteMoving = actor.hp > 0 && !!input && Math.hypot(input.dx, input.dy) > 0;
      if (input) connection.ack = input.seq;
      if (actor.hp <= 0) {
        if (this.mode !== 'arena' && this.now >= actor.deadUntil) this.respawn(actor);
        continue;
      }
      if (CLASSES[actor.classId].resource === 'mana') actor.resource = Math.min(actor.maxResource, actor.resource + 7 * dt);
      else if (this.now - connection.combatAt > 5000) actor.resource = Math.max(0, actor.resource - 6 * dt);
      if (this.now - connection.combatAt > 10_000) actor.hp = Math.min(actor.maxHp, actor.hp + 2 * dt);
      if (input) {
        actor.aim = input.aim;
        actor.spriteRow = playerSpriteDirectionRow(input.dx, input.dy, actor.spriteRow ?? 0, input.analogMovement === true);
        if (input.cast) this.pendingCasts.set(id, input);
        const magnitude = Math.hypot(input.dx, input.dy);
        if (magnitude > 0) Object.assign(actor, moveWithCollisions(actor, input.dx / Math.max(1, magnitude), input.dy / Math.max(1, magnitude), movementSpeed(actor, this.now) * terrainSpeed(actor, this.world) * dt, this.world));
      }
      actor.hidden = this.world.getTile(Math.floor(actor.x / TILE_SIZE), Math.floor(actor.y / TILE_SIZE)) === 'bush';
      if (this.mode === 'world' && !inOutpost(actor)) actor.spawnProtectedUntil = 0;
    }
    this.rebuildCells();
    // Casts use the input consumed this tick, captured independently of queue length.
    for (const [id, input] of this.pendingCasts) {
      const actor = this.players.get(id);
      if (actor && input.cast) this.cast(actor, input.cast, input.autoAim === true, input.targetId, input.seq);
    }
    this.pendingCasts.clear();
    this.stepNpcs(dt);
    for (const encounter of this.bosses.values()) encounter.step(this.now, dt, [...this.players.values()],
      id => !!this.connections.get(id)?.connected, this.world, (target, amount) => this.damage(target, encounter.boss, amount));
    resolveActorCollisions([...this.players.values(), ...this.npcs.values()].filter(actor => actor.hp > 0), this.world);
    if (this.mode === 'world') for (const actor of this.players.values()) if (!inOutpost(actor)) actor.spawnProtectedUntil = 0;
    this.rebuildCells();
    this.stepProjectiles(dt);
    this.stepBursts();
    this.stepTraps();
    this.stepPickups();
    for (const encounter of this.bosses.values()) for (const player of this.players.values()) encounter.collect(player, this.accounts.get(player.id)!, !!this.connections.get(player.id)?.connected, this.now);
    while (this.events.length && this.events[0].at + 1800 < this.now) this.events.shift();
    if (this.tick % 150 === 0) {
      this.checkpoint();
      this.pruneCaches();
    }
  }

  private readonly pendingCasts = new Map<string, InputCommand>();

  private safeSpawn(id: string): Vec2 {
    if (this.environment) return { ...this.environment.spawn };
    if (this.mode !== 'world') {
      const teamId = this.players.get(id)?.teamId;
      const side = teamId?.endsWith(':1') ? 1 : -1;
      const members = [...this.players.values()].filter(player => player.teamId === teamId);
      return { x: side * (this.mode === 'arena' ? 300 : 700), y: Math.max(0, members.findIndex(player => player.id === id)) * 70 - 140 };
    }
    let hash = 0;
    for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
    const angle = (hash % 6283) / 1000;
    for (let i = 0; i < 1200; i++) {
      const r = 40 + (Math.floor(i / 12) % 9) * 18;
      const point = { x: Math.cos(angle + i * 2.4) * r, y: Math.sin(angle + i * 2.4) * r };
      if (!insideArenaGate(point) && !collidesWorld(point.x, point.y, PLAYER_RADIUS + 2, this.world) && ![...this.players.values()].some(actor => actor.hp > 0 && distance(actor, point) < 40)) return point;
    }
    return { x: TILE_SIZE / 2, y: TILE_SIZE / 2 };
  }

  private rebuildCells(): void {
    this.cells.clear();
    this.largestActorRadius = PLAYER_RADIUS;
    for (const actor of [...this.players.values(), ...this.npcs.values()]) {
      if (actor.hp <= 0) continue;
      this.largestActorRadius = Math.max(this.largestActorRadius, actor.radius);
      const key = `${Math.floor(actor.x / 192)},${Math.floor(actor.y / 192)}`;
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, cell = []);
      cell.push(actor);
    }
  }

  private near(point: Vec2, radius: number): Actor[] {
    const found: Actor[] = [];
    const extent = radius + this.largestActorRadius;
    for (let cx = Math.floor((point.x - extent) / 192); cx <= Math.floor((point.x + extent) / 192); cx++) {
      for (let cy = Math.floor((point.y - extent) / 192); cy <= Math.floor((point.y + extent) / 192); cy++) {
        for (const actor of this.cells.get(`${cx},${cy}`) ?? []) if (distance(actor, point) <= radius + actor.radius) found.push(actor);
      }
    }
    return found;
  }

  private allied(a: Actor, b: Actor): boolean {
    return a.id === b.id || (a.kind === 'npc' && b.kind === 'npc') || (!!a.teamId && a.teamId === b.teamId);
  }

  private visibleTo(observer: Actor, target: Actor): boolean {
    return target.id === observer.id || (!!observer.teamId && target.teamId === observer.teamId)
      || !target.hidden || target.revealedUntil > this.now || distance(observer, target) < 120;
  }

  private nearestEnemy(actor: Actor): Actor | undefined {
    let nearest: Actor | undefined;
    let nearestDistance = INTEREST_RADIUS;
    for (const target of this.near(actor, INTEREST_RADIUS)) {
      const d = distance(actor, target);
      if (d >= nearestDistance || !this.canAutoAim(actor, target)) continue;
      nearest = target; nearestDistance = d;
    }
    return nearest;
  }

  private canAutoAim(actor: Actor, target: Actor): boolean {
    return target.hp > 0 && !this.allied(actor, target) && target.spawnProtectedUntil <= this.now
      && distance(actor, target) < INTEREST_RADIUS && this.visibleTo(actor, target) && hasLineOfSight(actor, target, this.world)
      && !(target.kind === 'player' && this.isSafeProtected(target))
      && (!target.bossKey || !!this.bosses.get(target.bossKey)?.canDamage(actor));
  }

  private emit(event: Omit<GameEvent, 'id' | 'at'>): void {
    this.events.push({ ...event, id: randomUUID(), at: this.now });
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
  }

  private effect(actor: Actor, kind: Actor['effects'][number]['kind'], duration: number): void {
    const current = actor.effects.find(effect => effect.kind === kind);
    if (current) current.until = Math.max(current.until, this.now + duration);
    else actor.effects.push({ kind, until: this.now + duration });
  }
  private stepBursts(): void {
    for (let i = this.queuedBursts.length - 1; i >= 0; i--) {
      const burst = this.queuedBursts[i];
      if (this.now >= burst.nextShotAt) {
        const owner = this.players.get(burst.ownerId) ?? this.npcs.get(burst.ownerId);
        if (owner && owner.hp > 0 && this.projectiles.size < 1000) {
          burst.currentAngle += burst.angleStep;
          const projectile: Projectile = {
            id: randomUUID(),
            ownerId: owner.id,
            x: owner.x,
            y: owner.y,
            vx: Math.cos(burst.currentAngle) * burst.speed,
            vy: Math.sin(burst.currentAngle) * burst.speed,
            radius: burst.radius,
            damage: burst.damage,
            expiresAt: this.now + (burst.range / burst.speed) * 1000,
            color: burst.color,
          };
          this.projectiles.set(projectile.id, projectile);
          this.projectileTeams.set(projectile.id, owner.teamId);
          this.emit({
            kind: 'cast',
            actorId: owner.id,
            x: owner.x,
            y: owner.y,
            aim: burst.currentAngle,
            abilityKind: 'projectile',
            radius: burst.radius,
            duration: 250,
            color: burst.color,
          });
        }
        burst.remainingShots--;
        burst.nextShotAt = this.now + burst.intervalMs;
        if (burst.remainingShots <= 0) {
          this.queuedBursts.splice(i, 1);
        }
      }
    }
  }

  private stepTraps(): void {
    for (const [id, trap] of this.traps) {
      if (this.now >= trap.expiresAt) {
        this.traps.delete(id);
        continue;
      }
      const owner = this.players.get(trap.ownerId) ?? this.npcs.get(trap.ownerId);
      let triggered = false;

      for (const target of this.near(trap, trap.radius)) {
        if (target.id === trap.ownerId || target.hp <= 0 || target.spawnProtectedUntil > this.now) continue;
        if (owner && this.allied(owner, target)) continue;
        if (trap.teamId && target.teamId === trap.teamId) continue;

        if (!this.damage(target, owner, trap.damage)) continue;
        triggered = true;
        this.effect(target, 'root', trap.duration);
        this.emit({
          kind: 'hit',
          x: trap.x,
          y: trap.y,
          actorId: trap.ownerId,
          targetId: target.id,
          amount: Math.round(trap.damage),
          radius: trap.radius,
          duration: 650,
          color: '#71c463',
          text: 'BLOCCATO!',
        });
        break;
      }

      if (triggered) {
        this.traps.delete(id);
      }
    }
  }

  /** May be used directly by deterministic combat tests; input validation precedes this in transport. */
  cast(actor: Actor, slot: AbilitySlot, autoAim = false, targetId?: string, inputSeq?: number): boolean {
    const ability = CLASSES[actor.classId].abilities[slot];
    if (this.isSafeProtected(actor) && ability.kind !== 'heal' && ability.kind !== 'shield') return false;
    if (actor.hp <= 0 || actor.cooldowns[slot] > this.now || actor.resource < ability.cost) return false;
    if (ability.kind === 'projectile' && this.projectiles.size >= 1000) return false;
    if (autoAim && ability.targeting === 'directional') {
      // An explicit selection never silently switches to a different enemy.
      const selected = targetId ? this.players.get(targetId) ?? this.npcs.get(targetId) : undefined;
      const target = targetId ? (selected && this.canAutoAim(actor, selected) ? selected : undefined) : this.nearestEnemy(actor);
      if (target) actor.aim = Math.atan2(target.y - actor.y, target.x - actor.x);
    }
    actor.resource -= ability.cost;
    actor.cooldowns[slot] = this.now + ability.cooldown * 1000;
    actor.spawnProtectedUntil = 0;
    actor.revealedUntil = this.now + 2500;
    const connection = this.connections.get(actor.id);
    if (connection) connection.combatAt = this.now;
    this.emit({ kind: 'cast', x: actor.x, y: actor.y, radius: ability.radius, color: ability.color, duration: ability.kind === 'shield' ? 700 : 380, actorId: actor.id, aim: actor.aim, abilityKind: ability.kind, text: ability.name, ...(inputSeq !== undefined ? { inputSeq } : {}) });
    if (ability.kind === 'projectile') {
      const speed = ability.speed ?? 400;
      const projectile: Projectile = { id: randomUUID(), ownerId: actor.id, x: actor.x, y: actor.y, vx: Math.cos(actor.aim) * speed, vy: Math.sin(actor.aim) * speed, radius: ability.radius, damage: ability.damage * this.damageMultiplier(actor), expiresAt: this.now + ability.range / speed * 1000, color: ability.color, slow: actor.classId === 'mage' && slot === 'q' ? 2000 : undefined };
      if (inputSeq !== undefined) projectile.inputSeq = inputSeq;
      this.projectiles.set(projectile.id, projectile);
      this.projectileTeams.set(projectile.id, actor.teamId);
      return true;
    }
    // Gestione della trappola dell'Hunter
    if (ability.kind === 'trap') {
      const dist = Math.min(ability.range || 60, 60);
      const placeX = actor.x + Math.cos(actor.aim) * dist;
      const placeY = actor.y + Math.sin(actor.aim) * dist;
      const trapId = randomUUID();
      const trap: Trap = {
        id: trapId,
        ownerId: actor.id,
        teamId: actor.teamId,
        x: placeX,
        y: placeY,
        radius: ability.radius || 52,
        damage: ability.damage * this.damageMultiplier(actor),
        duration: 2500, // 2.5 secondi di blocco
        expiresAt: this.now + (ability.duration ?? 30) * 1000,
        color: ability.color,
      };
      this.traps.set(trapId, trap);
      this.emit({ kind: 'cast', x: placeX, y: placeY, radius: trap.radius, color: trap.color, duration: 450, actorId: actor.id, abilityKind: 'trap', text: ability.name });
      return true;
    }

    // Gestione della Ultimate R a 360° in sequenza
    if (actor.classId === 'hunter' && slot === 'r') {
      const speed = ability.speed ?? 500;
      const totalShots = 6;
      const angleStep = (Math.PI * 2) / totalShots;
      const startAngle = actor.aim;
      const damage = ability.damage * this.damageMultiplier(actor);
      const range = ability.range || 520;

      // Primo dardo sparato subito
      const firstShot: Projectile = {
        id: randomUUID(),
        ownerId: actor.id,
        x: actor.x,
        y: actor.y,
        vx: Math.cos(startAngle) * speed,
        vy: Math.sin(startAngle) * speed,
        radius: ability.radius,
        damage,
        expiresAt: this.now + (range / speed) * 1000,
        color: ability.color,
      };
      this.projectiles.set(firstShot.id, firstShot);
      this.projectileTeams.set(firstShot.id, actor.teamId);

      // Gli altri 5 colpi sparati in sequenza con 70 ms di scarto
      this.queuedBursts.push({
        ownerId: actor.id,
        remainingShots: totalShots - 1,
        intervalMs: 70,
        nextShotAt: this.now + 70,
        currentAngle: startAngle,
        angleStep,
        speed,
        damage,
        radius: ability.radius,
        range,
        color: ability.color,
      });
      return true;
    }
    if (ability.kind === 'dash') {
      const start = { x: actor.x, y: actor.y };
      const intended = { x: start.x + Math.cos(actor.aim) * ability.range, y: start.y + Math.sin(actor.aim) * ability.range };
      const wall = sweptWorldHit(start, intended, actor.radius, this.world);
      const travel = wall === null ? 1 : Math.max(0, wall - 0.001);
      const end = { x: start.x + (intended.x - start.x) * travel, y: start.y + (intended.y - start.y) * travel };
      let contact: Actor | undefined;
      let fraction = 1;
      for (const target of this.near(start, ability.range + 50)) {
        if (target.id === actor.id) continue;
        const hit = segmentCircleHit(start, end, target, target.radius + actor.radius + 0.5);
        if (hit !== null && hit < fraction) { fraction = hit; contact = target; }
      }
      actor.x = start.x + (end.x - start.x) * fraction;
      actor.y = start.y + (end.y - start.y) * fraction;
      if (contact && !this.allied(actor, contact) && hasLineOfSight(actor, contact, this.world)) this.damage(contact, actor, ability.damage * this.damageMultiplier(actor));
      return true;
    }
    for (const target of this.near(actor, ability.range || ability.radius)) {
      const ally = this.allied(actor, target);
      if (!hasLineOfSight(actor, target, this.world)) continue;
      if (ability.kind === 'heal' || ability.kind === 'shield') {
        if (!ally) continue;
        if (this.isSafeProtected(actor) && (target.pvpUntil ?? 0) > this.now) continue;
        if (ability.kind === 'heal') this.heal(target, ability.damage, actor.id);
        else this.effect(target, 'shield', (ability.duration ?? 4) * 1000);
        continue;
      }
      if (ally) continue;
      if (ability.kind === 'melee') {
        const angle = Math.atan2(target.y - actor.y, target.x - actor.x);
        if (Math.cos(angle - actor.aim) < Math.cos(Math.PI * 0.38)) continue;
      }
      this.damage(target, actor, ability.damage * this.damageMultiplier(actor));
    }
    return true;
  }

  private damageMultiplier(actor: Actor): number {
    return (actor.effects.some(effect => effect.kind === 'power' && effect.until > this.now) ? 1.3 : 1) * (actor.effects.some(effect => effect.kind === 'weakness' && effect.until > this.now) ? 0.7 : 1);
  }

  private damage(target: Actor, attacker: Actor | undefined, amount: number): boolean {
    if (target.hp <= 0 || target.spawnProtectedUntil > this.now || (attacker && this.allied(attacker, target))) return false;
    const encounter = target.bossKey ? this.bosses.get(target.bossKey) : undefined;
    if (encounter && !encounter.canDamage(attacker)) return false;
    if (target.kind === 'player' && attacker?.kind !== 'npc' && (this.isSafeProtected(target) || (attacker && this.isSafeProtected(attacker)))) return false;
    const armor = target.kind === 'npc' ? (target.npcKind === 'sentinel' ? 0.15 : 0) : CLASSES[target.classId].armor;
    const shield = target.effects.some(effect => effect.kind === 'shield' && effect.until > this.now) ? 0.4 : 1;
    const applied = Math.max(1, Math.round(amount * (1 - armor) * shield));
    target.hp = Math.max(0, target.hp - applied);
    if (encounter && attacker?.kind === 'player') encounter.recordDamage(attacker.id, applied);
    if (this.mode === 'world' && target.kind === 'player' && attacker?.kind === 'player') {
      target.pvpUntil = attacker.pvpUntil = this.now + OUTPOST.combatMs;
    }
    target.revealedUntil = this.now + 2500;
    const connection = this.connections.get(target.id);
    if (connection) connection.combatAt = this.now;
    if (CLASSES[target.classId].resource === 'rage') target.resource = Math.min(target.maxResource, target.resource + 8);
    if (attacker) {
      const source = this.connections.get(attacker.id);
      if (source) source.combatAt = this.now;
      if (CLASSES[attacker.classId].resource === 'rage') attacker.resource = Math.min(attacker.maxResource, attacker.resource + 12);
    }
    this.emit({ kind: 'hit', x: target.x, y: target.y, actorId: attacker?.id, targetId: target.id, amount: applied, radius: 26, duration: 500, color: '#ffb8a2' });
    if (target.hp > 0) return true;
    if (target.kind === 'player') for (const boss of this.bosses.values()) boss.participantDied(target.id, this.world);
    target.deaths++;
    target.deadUntil = this.now + (target.kind === 'npc' ? 35_000 : 5000);
    target.effects = [];
    this.emit({ kind: 'death', x: target.x, y: target.y, actorId: target.id, radius: 65, duration: 800, color: '#ffd4a3' });
    if (attacker?.kind === 'player' && !encounter) {
      if (target.kind === 'player') attacker.kills++;
      attacker.xp += target.kind === 'player' ? 50 : 20 + target.level * 3;
      attacker.level = levelFromXp(attacker.xp);
      this.persistPlayer(attacker.id);
    }
    if (target.kind === 'player') this.persistPlayer(target.id);
    for (const reward of encounter?.killed(attacker?.kind === 'player' ? attacker.id : undefined, this.now, this.world) ?? []) {
      const recipient = this.players.get(reward.id);
      if (!recipient) continue;
      recipient.xp += reward.xp;
      recipient.level = levelFromXp(recipient.xp);
      this.persistPlayer(recipient.id);
    }
    return true;
  }

  private heal(actor: Actor, amount: number, sourceId = actor.id): void {
    if (actor.hp <= 0) return;
    const gained = Math.min(amount, actor.maxHp - actor.hp);
    actor.hp += gained;
    this.emit({ kind: 'heal', x: actor.x, y: actor.y, actorId: sourceId, targetId: actor.id, amount: Math.round(gained), radius: 32, duration: 600, color: '#b7edb5' });
  }

  private respawn(actor: Actor): void {
    Object.assign(actor, this.safeSpawn(actor.id));
    actor.hp = actor.maxHp;
    actor.resource = CLASSES[actor.classId].resource === 'mana' ? actor.maxResource : 0;
    actor.deadUntil = 0;
    actor.spawnProtectedUntil = this.now + 5000;
    actor.pvpUntil = 0;
    actor.effects = [];
    actor.hidden = false;
    this.emit({ kind: 'respawn', x: actor.x, y: actor.y, actorId: actor.id, radius: 70, duration: 700, color: '#bcebdc' });
  }

  private stepProjectiles(dt: number): void {
    for (const [id, projectile] of this.projectiles) {
      const owner = this.players.get(projectile.ownerId) ?? this.npcs.get(projectile.ownerId);
      const travelDt = Math.min(dt, Math.max(0, (projectile.expiresAt - (this.now - dt * 1000)) / 1000));
      const start = { x: projectile.x, y: projectile.y };
      const end = { x: start.x + projectile.vx * travelDt, y: start.y + projectile.vy * travelDt };
      const wallAt = sweptWorldHit(start, end, projectile.radius, this.world) ?? 1.01;
      let hit: Actor | undefined;
      let hitAt = wallAt;
      const oldTeam = this.projectileTeams.get(id);
      for (const actor of this.near(start, distance(start, end) + projectile.radius + 30)) {
        if (actor.id === projectile.ownerId || actor.spawnProtectedUntil > this.now || (owner && this.allied(owner, actor)) || (oldTeam && actor.teamId === oldTeam)) continue;
        const t = segmentCircleHit(start, end, actor, actor.radius + projectile.radius);
        if (t !== null && t < hitAt) { hitAt = t; hit = actor; }
      }
      if (hit) {
        const applied = this.damage(hit, owner, projectile.damage);
        if (applied && projectile.slow && hit.hp > 0) this.effect(hit, 'slow', projectile.slow);
      }
      if (hit || wallAt <= 1 || this.now >= projectile.expiresAt) {
        this.projectiles.delete(id);
        this.projectileTeams.delete(id);
      } else Object.assign(projectile, end);
    }
  }

  private updateChunks(): void {
    const wanted = new Set<string>();
    for (const actor of this.players.values()) {
      const coords = chunkCoords(actor.x, actor.y);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const cx = coords.cx + dx, cy = coords.cy + dy, key = chunkKey(cx, cy);
        wanted.add(key);
        const existing = this.activeChunks.get(key);
        if (existing) { existing.lastUsed = this.now; continue; }
        if (this.activeChunks.size >= 1152) continue;
        const generated = this.world.getChunk(cx, cy);
        const chunk: ActiveChunk = { key, lastUsed: this.now, npcIds: [], pickupIds: [] };
        this.activeChunks.set(key, chunk);
        for (const npc of generated.npcs) {
          if (this.npcs.size >= 3000) break;
          const slept = this.npcSleep.get(npc.id);
          const npcHp = 55 + Math.min(npc.level, 12) * 12;
          const spec = NPC_CATALOG[npc.npcKind];
          const actor: Actor = slept ? copyActor(slept.body) : {
            id: npc.id, kind: 'npc', npcKind: npc.npcKind, classId: spec.classId,
            name: spec.name,
            x: npc.x, y: npc.y, radius: spec.radius,
            hp: npcHp, maxHp: npcHp, resource: 0, maxResource: 100, aim: 0, speed: spec.speed,
            level: npc.level, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: EMPTY_COOLDOWNS(),
          };
          this.npcs.set(actor.id, actor);
          this.npcMeta.set(actor.id, { home: { x: npc.x, y: npc.y }, chunk: key, nextAttack: slept?.nextAttack ?? this.now + 1500 });
          this.npcSleep.delete(actor.id);
          chunk.npcIds.push(actor.id);
        }
        for (const pickup of generated.pickups) {
          chunk.pickupIds.push(pickup.id);
          if ((this.pickupReady.get(pickup.id) ?? 0) <= this.now) this.pickups.set(pickup.id, { ...pickup });
        }
      }
    }
    for (const [key, chunk] of this.activeChunks) {
      if (wanted.has(key) || this.now - chunk.lastUsed < 20_000) continue;
      for (const id of chunk.npcIds) {
        const actor = this.npcs.get(id), meta = this.npcMeta.get(id);
        if (actor && meta) this.npcSleep.set(id, { body: copyActor(actor), nextAttack: meta.nextAttack, until: this.now + 300_000 });
        this.npcs.delete(id);
        this.npcMeta.delete(id);
      }
      for (const id of chunk.pickupIds) this.pickups.delete(id);
      this.activeChunks.delete(key);
    }
  }

  private stepNpcs(dt: number): void {
    for (const npc of this.npcs.values()) {
      if (npc.npcKind === 'boss') continue;
      const meta = this.npcMeta.get(npc.id)!;
      if (npc.hp <= 0) {
        if (this.now >= npc.deadUntil) { Object.assign(npc, meta.home); npc.hp = npc.maxHp; npc.deadUntil = 0; npc.effects = []; meta.nextAttack = this.now + 1200; }
        continue;
      }
      npc.effects = npc.effects.filter(effect => effect.until > this.now);
      const candidates = this.near(npc, 370).filter(actor => actor.kind === 'player' && actor.hp > 0 && actor.spawnProtectedUntil <= this.now && (!actor.hidden || actor.revealedUntil > this.now || distance(npc, actor) < 100));
      const target = candidates.filter(actor => distance(actor, meta.home) < 650 && hasLineOfSight(npc, actor, this.world)).sort((a, b) => distance(npc, a) - distance(npc, b))[0];
      const objective = target ?? meta.home;
      const d = distance(npc, objective);
      const attackRange = npc.npcKind === 'wisp' ? 230 : 43;
      npc.aim = Math.atan2(objective.y - npc.y, objective.x - npc.x);
      if (d > (target ? attackRange * 0.85 : 8)) Object.assign(npc, moveWithCollisions(npc, Math.cos(npc.aim), Math.sin(npc.aim), movementSpeed(npc, this.now) * terrainSpeed(npc, this.world) * dt, this.world));
      if (target && d < attackRange && this.now >= meta.nextAttack) {
        meta.nextAttack = this.now + (npc.npcKind === 'wisp' ? 1900 : 1300);
        if (npc.npcKind === 'wisp' && this.projectiles.size < 1000) {
          const projectile: Projectile = { id: randomUUID(), ownerId: npc.id, x: npc.x, y: npc.y, vx: Math.cos(npc.aim) * 270, vy: Math.sin(npc.aim) * 270, radius: 7, damage: 9 + Math.min(10, npc.level), expiresAt: this.now + 1300, color: '#b5dff2' };
          this.projectiles.set(projectile.id, projectile);
          this.projectileTeams.set(projectile.id, null);
        } else this.damage(target, npc, 8 + Math.min(npc.level, 10));
        this.emit({ kind: 'cast', actorId: npc.id, x: npc.x, y: npc.y, aim: npc.aim, abilityKind: npc.npcKind === 'wisp' ? 'projectile' : 'melee', radius: attackRange, duration: 300, color: '#e4b79d' });
      } else if (!target && d < 15) npc.hp = Math.min(npc.maxHp, npc.hp + 8 * dt);
      npc.hidden = this.world.getTile(Math.floor(npc.x / TILE_SIZE), Math.floor(npc.y / TILE_SIZE)) === 'bush';
    }
  }

  private stepPickups(): void {
    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;
      for (const [id, pickup] of this.pickups) {
        if (distance(player, pickup) > player.radius + pickup.radius) continue;
        if (pickup.kind === 'heal') this.heal(player, 35);
        else this.effect(player, pickup.kind, pickup.kind === 'weakness' ? 7000 : 10_000);
        this.pickups.delete(id);
        this.pickupReady.set(id, this.now + 35_000);
        this.emit({ kind: 'pickup', x: pickup.x, y: pickup.y, actorId: player.id, radius: 42, duration: 650, color: pickup.kind === 'weakness' ? '#c297db' : '#e9d49f', text: pickup.kind });
      }
    }
    if (this.tick % 30 !== 0) return;
    for (const [id, readyAt] of this.pickupReady) {
      if (readyAt > this.now) continue;
      this.pickupReady.delete(id);
      for (const chunk of this.activeChunks.values()) {
        if (!chunk.pickupIds.includes(id)) continue;
        const [cx, cy] = chunk.key.split(',').map(Number);
        const pickup = this.world.getChunk(cx, cy).pickups.find(item => item.id === id);
        if (pickup) this.pickups.set(id, { ...pickup });
      }
    }
  }

  snapshotFor(id: string): Snapshot | undefined {
    const self = this.players.get(id), connection = this.connections.get(id);
    if (!self || !connection) return undefined;
    const visible = (actor: Actor) => this.visibleTo(self, actor);
    // I compagni restano sincronizzati anche quando sono molto lontani: il client
    // può così mostrarli sul bordo dello schermo invece di perderne la posizione.
    const actors = [...this.players.values(), ...this.npcs.values()].filter(actor =>
      (actor.id === id || (!!self.teamId && actor.teamId === self.teamId) || distance(self, actor) < INTEREST_RADIUS) && visible(actor)
    ).map(copyActor);
    const visibleIds = new Set(actors.map(actor => actor.id));
    return {
      type: 'snapshot', tick: this.tick, time: this.now, ack: connection.ack, self: copyActor(self), actors,
      gold: this.accounts.get(id)?.gold ?? 0,
      goldDrops: [...this.bosses.values()].flatMap(encounter => encounter.state.drops.filter(drop => drop.ownerId === id && drop.expiresAt > this.now && distance(self, drop) < INTEREST_RADIUS).map(drop => ({ ...drop }))),
      bossWindups: [...this.bosses.values()].flatMap(encounter => encounter.windup && distance(self, encounter.windup) < INTEREST_RADIUS ? [{ ...encounter.windup }] : []),
      bossLocks: [...this.bosses.values()].map(encounter => encounter.lockState(self)),
      bossPreparations: [...this.bosses.values()].flatMap(encounter => encounter.preparationFor(self) ?? []),
      projectiles: [...this.projectiles.values()].filter(projectile => distance(self, projectile) < INTEREST_RADIUS).map(projectile => ({ ...projectile })),
      pickups: [...this.pickups.values()].filter(pickup => distance(self, pickup) < INTEREST_RADIUS).map(pickup => ({ ...pickup })),
      traps: [...this.traps.values()].filter(trap => distance(self, trap) < INTEREST_RADIUS).map(trap => ({ ...trap })),
      events: this.events.filter(event => distance(self, event) < INTEREST_RADIUS && (!event.actorId || visibleIds.has(event.actorId)) && (!event.targetId || visibleIds.has(event.targetId))).map(event => ({ ...event })),
      online: this.online, activeChunks: this.activeChunks.size,
    };
  }

  private teamFor(id: string): Team | undefined { return [...this.teams.values()].find(team => team.members.has(id)); }

  private dissolveTeam(team: Team): void {
    for (const id of team.members) {
      const actor = this.players.get(id);
      if (actor) actor.teamId = null;
    }
    this.teams.delete(team.id);
    for (const [id, invites] of this.invites) {
      const remaining = invites.filter(invite => invite.teamId !== team.id);
      if (remaining.length) this.invites.set(id, remaining); else this.invites.delete(id);
    }
  }

  /** Also used on logout and after the reconnect grace; room transfers keep membership. */
  leaveTeam(id: string): void {
    const team = this.teamFor(id);
    if (!team) return;
    team.members.delete(id);
    const actor = this.players.get(id);
    if (actor) actor.teamId = null;
    if (team.members.size < 2) this.dissolveTeam(team);
    else if (team.leaderId === id) {
      team.leaderId = [...team.members].sort((a, b) => Number(!!this.connections.get(b)?.connected || this.awayPlayers.has(b)) - Number(!!this.connections.get(a)?.connected || this.awayPlayers.has(a)))[0];
    }
  }

  socialFor(id: string): SocialState {
    const account = this.accounts.get(id)!;
    const actor = this.players.get(id);
    const team = this.teamFor(id);
    const online = (memberId: string) => !!this.connections.get(memberId)?.connected;
    const name = (memberId: string) => this.accounts.get(memberId)?.name ?? 'Viandante';
    return {
      friends: account.friends.map(friendId => ({ id: friendId, name: name(friendId), online: online(friendId) })),
      requests: account.requests.map(requestId => ({ id: requestId, name: name(requestId) })),
      teamInvites: (this.invites.get(id) ?? []).filter(invite => invite.expiresAt > this.now && this.teams.get(invite.teamId)?.members.has(invite.fromId)).map(invite => ({ id: invite.fromId, name: name(invite.fromId), teamId: invite.teamId })),
      team: team && team.members.size > 1 ? { id: team.id, leaderId: team.leaderId, members: [...team.members].map(memberId => ({ id: memberId, name: name(memberId), online: online(memberId), hp: this.players.get(memberId)?.hp, maxHp: this.players.get(memberId)?.maxHp })) } : null,
      nearby: actor ? [...this.players.values()].filter(player => player.id !== id && online(player.id) && distance(actor, player) < INTEREST_RADIUS && (!player.hidden || player.revealedUntil > this.now || distance(actor, player) < 120 || (!!actor.teamId && actor.teamId === player.teamId))).slice(0, 40).map(player => ({ id: player.id, name: player.name, classId: player.classId, level: player.level, teamId: player.teamId, friend: account.friends.includes(player.id) })) : [],
    };
  }

  socialAction(id: string, action: SocialAction, targetId?: string): string {
    const account = this.accounts.get(id);
    if (!account) throw new Error('Account sconosciuto.');
    const target = targetId ? this.accounts.get(targetId) : undefined;
    if (action !== 'team-leave' && (!target || targetId === id)) throw new Error('Scegli un altro giocatore valido.');
    if (action === 'friend-request') {
      if (account.friends.includes(targetId!)) throw new Error('Siete già amici.');
      if (account.friends.length >= 100 || target!.friends.length >= 100 || target!.requests.length >= 50) throw new Error('Limite amicizie o richieste raggiunto.');
      if (target!.requests.includes(id)) throw new Error('Richiesta già inviata.');
      target!.requests.push(id);
    } else if (action === 'friend-accept') {
      if (!account.requests.includes(targetId!)) throw new Error('La richiesta non è più valida.');
      if (account.friends.length >= 100 || target!.friends.length >= 100) throw new Error('Limite di 100 amici raggiunto.');
      account.requests = account.requests.filter(request => request !== targetId);
      target!.requests = target!.requests.filter(request => request !== id);
      if (!account.friends.includes(targetId!)) account.friends.push(targetId!);
      if (!target!.friends.includes(id)) target!.friends.push(id);
    } else if (action === 'friend-decline') account.requests = account.requests.filter(request => request !== targetId);
    else if (action === 'friend-remove') {
      account.friends = account.friends.filter(friend => friend !== targetId);
      target!.friends = target!.friends.filter(friend => friend !== id);
    } else if (action === 'team-invite') {
      if ((this.invites.get(targetId!) ?? []).some(invite => invite.fromId === id && invite.expiresAt > this.now && this.teams.get(invite.teamId)?.members.has(id))) return '';
      if (!this.connections.get(targetId!)?.connected) throw new Error('Questo giocatore è offline.');
      if ((this.teamFor(targetId!)?.members.size ?? 0) > 1) throw new Error('Il giocatore è già in un team.');
      let team = this.teamFor(id);
      if (!team) { team = { id: randomUUID(), leaderId: id, members: new Set([id]) }; this.teams.set(team.id, team); }
      if (team.leaderId !== id) throw new Error('Solo il caposquadra può invitare.');
      if (team.members.size >= 5) throw new Error('Il team è completo (5 giocatori).');
      const invitations = (this.invites.get(targetId!) ?? []).filter(invite => invite.expiresAt > this.now && invite.teamId !== team.id);
      if (invitations.length >= 10) throw new Error('Il giocatore ha troppi inviti in sospeso.');
      invitations.push({ fromId: id, teamId: team.id, expiresAt: this.now + 60_000 });
      this.invites.set(targetId!, invitations);
    } else if (action === 'team-accept') {
      const previous = this.teamFor(id);
      if (previous && previous.members.size > 1) throw new Error('Esci dal team attuale prima di accettare.');
      const invitation = (this.invites.get(id) ?? []).find(invite => invite.fromId === targetId && invite.expiresAt > this.now);
      const team = invitation ? this.teams.get(invitation.teamId) : undefined;
      if (!team || !team.members.has(targetId!)) throw new Error('Invito scaduto.');
      if (team.members.size >= 5) throw new Error('Il team è completo.');
      if (previous) this.dissolveTeam(previous);
      team.members.add(id);
      for (const memberId of team.members) {
        const member = this.players.get(memberId);
        if (member) member.teamId = team.id;
      }
      this.invites.delete(id);
    } else if (action === 'team-decline') this.invites.set(id, (this.invites.get(id) ?? []).filter(invite => invite.fromId !== targetId));
    else if (action === 'team-leave') {
      const team = this.teamFor(id);
      if (!team) throw new Error('Non fai parte di un team.');
      this.leaveTeam(id);
    }
    this.pruneTeams();
    this.store?.touch();
    return ({ 'friend-request': 'Richiesta di amicizia inviata.', 'friend-accept': 'Amicizia accettata.', 'friend-decline': 'Richiesta rifiutata.', 'friend-remove': 'Amicizia rimossa.', 'team-invite': 'Invito al team inviato.', 'team-accept': 'Sei entrato nel team.', 'team-decline': 'Invito rifiutato.', 'team-leave': 'Hai lasciato il team.' } as const)[action];
  }

  private persistPlayer(id: string): void {
    const actor = this.players.get(id), account = this.accounts.get(id);
    if (!actor || !account) return;
    account.body = copyActor(actor);
    account.xp = actor.xp;
    account.kills = actor.kills;
    account.deaths = actor.deaths;
    account.lastSeen = this.now;
    this.store?.touch();
  }

  checkpoint(): void { for (const id of this.players.keys()) this.persistPlayer(id); }

  private pruneCaches(): void {
    for (const [id, saved] of this.npcSleep) if (saved.until < this.now) this.npcSleep.delete(id);
    while (this.npcSleep.size > 5000) this.npcSleep.delete(this.npcSleep.keys().next().value!);
    this.pruneTeams();
  }

  private pruneTeams(): void {
    for (const [id, invitations] of this.invites) {
      const active = invitations.filter(invite => invite.expiresAt > this.now && this.teams.get(invite.teamId)?.members.has(invite.fromId));
      if (active.length) this.invites.set(id, active); else this.invites.delete(id);
    }
    for (const team of this.teams.values()) {
      const pending = [...this.invites.values()].some(invites => invites.some(invite => invite.teamId === team.id));
      if ((team.members.size < 2 && !pending) || ![...team.members].some(member => this.players.has(member) || this.awayPlayers.has(member))) this.dissolveTeam(team);
    }
  }
}
