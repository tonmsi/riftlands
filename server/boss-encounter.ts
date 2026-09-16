import { randomUUID } from 'node:crypto';
import type { Actor, Vec2 } from '../shared/types';
import type { BossAttackDefinition, BossDefinition, BossLockState, BossPreparationState, BossState, BossWindup } from '../shared/bosses';
import { collidesWorld, hasLineOfSight, moveWithCollisions, movementSpeed, segmentCircleHit } from '../shared/physics';
import type { World } from '../shared/world';
import { DUNGEON_BY_ID, clampToDungeonRegion, insideDungeonRegion, touchesDungeonFlame } from '../shared/dungeons';
import type { DungeonDefinition } from '../shared/dungeons';
import type { Account, AccountStore } from './store';

/** Shared runtime for data-defined bosses. Unique mechanics can extend this class later without duplicating its lifecycle. */
export class BossEncounter {
  readonly dungeon: DungeonDefinition;
  readonly boss: Actor;
  readonly state: BossState;
  windup?: BossWindup;
  ownerId?: string;
  readonly participantIds = new Set<string>();
  targetId?: string;
  private preparation?: { initiatorId: string; teamId: string; endsAt: number };
  private preparationEntrants = 0;
  private readonly preparedIds = new Set<string>();
  private readonly eliminatedIds = new Set<string>();
  private readonly threat = new Map<string, number>();
  private nextAttack = 0;
  private attackIndex = 0;
  private path: Vec2[] = [];
  private pathTargetId?: string;
  private pathRefreshAt = 0;
  private stalledSince?: number;
  private unstuckUntil = 0;
  private unstuckAngle = 0;
  private lastUnstuckSector = -1;

  constructor(readonly definition: BossDefinition, now: number, state: BossState | undefined, private readonly store?: AccountStore) {
    const dungeon = DUNGEON_BY_ID.get(definition.dungeonId);
    if (!dungeon || dungeon.bossId !== definition.id) throw new Error(`Configurazione dungeon assente per ${definition.id}.`);
    this.dungeon = dungeon;
    const spawn = dungeon.spawnPoints.boss;
    this.state = state ?? { respawnAt: 0, corpse: { ...spawn }, drops: [] };
    const dead = this.state.respawnAt > now;
    this.boss = {
      id: definition.id, bossKey: definition.id, bossSkin: definition.skin, name: definition.name, kind: 'npc', npcKind: 'boss', classId: definition.classId,
      x: dead ? this.state.corpse.x : spawn.x, y: dead ? this.state.corpse.y : spawn.y,
      radius: definition.radius, hp: dead ? 0 : definition.hp, maxHp: definition.hp, resource: 0, maxResource: 100, aim: Math.PI / 2,
      speed: definition.speed, level: definition.level, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0,
      deadUntil: dead ? this.state.respawnAt : 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 },
    };
  }

  lockState(viewer?: Actor): BossLockState {
    const locked = !!this.ownerId;
    return {
      bossId: this.definition.id,
      locked,
      ...(this.ownerId ? { ownerId: this.ownerId } : {}),
      ...(locked && viewer ? { relation: this.isActiveParticipant(viewer.id) ? 'participant' as const
        : this.isEliminated(viewer.id) ? 'eliminated' as const : 'outsider' as const } : {}),
    };
  }
  preparationFor(player: Actor): BossPreparationState | undefined {
    if (!this.preparation || player.teamId !== this.preparation.teamId) return undefined;
    return { bossId: this.definition.id, name: this.definition.name, endsAt: this.preparation.endsAt, entrants: this.preparationEntrants };
  }
  canDamage(attacker: Actor | undefined): boolean { return !!attacker && attacker.kind === 'player' && this.isActiveParticipant(attacker.id); }
  hasParticipant(id: string): boolean { return this.participantIds.has(id); }
  isActiveParticipant(id: string): boolean { return this.participantIds.has(id) && !this.eliminatedIds.has(id); }
  isEliminated(id: string): boolean { return this.eliminatedIds.has(id); }
  eliminate(id: string): void { if (this.participantIds.has(id)) this.eliminatedIds.add(id); }
  recordDamage(id: string, amount: number): void {
    if (this.isActiveParticipant(id) && Number.isFinite(amount) && amount > 0) this.threat.set(id, (this.threat.get(id) ?? 0) + amount);
  }

  killed(ownerId: string | undefined, now: number, world: World): void {
    if (this.state.respawnAt > now || !ownerId || !this.participantIds.has(ownerId)) return;
    this.windup = undefined;
    this.resetPath();
    this.state.respawnAt = now + this.definition.respawnMs;
    this.boss.deadUntil = this.state.respawnAt;
    this.state.corpse = { x: this.boss.x, y: this.boss.y };
    this.state.drops = this.state.drops.filter(drop => drop.expiresAt > now);
    const recipients = [...this.participantIds], share = Math.floor(this.definition.reward.gold / recipients.length);
    if (share > 0) for (const recipient of recipients) this.state.drops.push({ id: randomUUID(), bossId: this.definition.id, ownerId: recipient, amount: share,
      ...this.state.corpse, availableAt: now + 500, expiresAt: now + this.definition.reward.lootMs });
    this.unlock(world);
    this.save();
  }

  collect(player: Actor, account: Account, connected: boolean, now: number): void {
    if (!connected || player.hp <= 0) return;
    const collectible = this.state.drops.filter(drop => drop.ownerId === player.id && drop.availableAt <= now && drop.expiresAt > now
      && Math.hypot(player.x - drop.x, player.y - drop.y) <= player.radius + 18);
    if (!collectible.length) return;
    const gold = (account.gold ?? 0) + collectible.reduce((sum, drop) => sum + drop.amount, 0);
    if (!Number.isSafeInteger(gold)) return;
    const ids = new Set(collectible.map(drop => drop.id));
    account.gold = gold;
    this.state.drops = this.state.drops.filter(drop => !ids.has(drop.id));
    this.save();
  }

  step(now: number, dt: number, players: Actor[], connected: (id: string) => boolean, world: World, damage: (target: Actor, amount: number) => void): void {
    const boss = this.boss;
    if (this.state.drops.some(drop => drop.expiresAt <= now)) {
      this.state.drops = this.state.drops.filter(drop => drop.expiresAt > now);
      this.save();
    }
    if (boss.hp <= 0) {
      this.unlock(world);
      if (now < this.state.respawnAt) return;
      Object.assign(boss, { ...this.dungeon.spawnPoints.boss, hp: this.definition.hp, deadUntil: 0, effects: [] });
      this.state.respawnAt = 0; this.nextAttack = now + 1500; this.attackIndex = 0; this.resetPath();
      this.save();
      return;
    }

    if (!this.ownerId) {
      if (this.preparation) {
        const initiator = players.find(player => player.id === this.preparation!.initiatorId);
        if (!initiator || initiator.hp <= 0 || !connected(initiator.id) || initiator.teamId !== this.preparation.teamId
          || !insideDungeonRegion(this.dungeon.encounter.regions.combat, initiator)) {
          this.cancelPreparation(); this.resetFight(); return;
        }
        for (const player of players) {
          if (player.teamId === this.preparation.teamId && player.hp > 0 && connected(player.id)
            && insideDungeonRegion(this.dungeon.encounter.regions.admission, player)) this.preparedIds.add(player.id);
          if (this.preparedIds.has(player.id) && (player.teamId !== this.preparation.teamId || player.hp <= 0 || !connected(player.id)
            || !insideDungeonRegion(this.dungeon.encounter.regions.combat, player))) this.preparedIds.delete(player.id);
        }
        const entrants = players.filter(player => this.preparedIds.has(player.id) && player.hp > 0 && connected(player.id)
          && player.teamId === this.preparation!.teamId && insideDungeonRegion(this.dungeon.encounter.regions.combat, player));
        this.preparationEntrants = this.preparedIds.size;
        if (now < this.preparation.endsAt) return;
        this.preparation = undefined;
        this.beginEncounter(initiator, entrants, now, world, true);
      } else {
        const leader = players.find(player => player.hp > 0 && connected(player.id)
          && insideDungeonRegion(this.dungeon.encounter.regions.trigger, player));
        if (!leader) { this.resetFight(); return; }
        if (leader.teamId && this.dungeon.encounter.preparationMs > 0) {
          this.preparation = { initiatorId: leader.id, teamId: leader.teamId, endsAt: now + this.dungeon.encounter.preparationMs };
          this.preparedIds.add(leader.id);
          this.preparationEntrants = 1;
          this.resetFight();
          return;
        }
        this.beginEncounter(leader, [leader], now, world, false);
      }
    }
    for (const player of players) if (this.participantIds.has(player.id) && player.hp <= 0) this.eliminate(player.id);
    for (const player of players) if (this.hasParticipant(player.id) && player.hp > 0
      && touchesDungeonFlame(this.dungeon, player, player.radius)) damage(player, Number.MAX_SAFE_INTEGER);
    for (const player of players) if (!this.isActiveParticipant(player.id) && player.hp > 0
      && insideDungeonRegion(this.dungeon.encounter.regions.ejectIntruders, player)) this.eject(player);
    for (const player of players) if (this.isActiveParticipant(player.id) && player.hp > 0
      && !insideDungeonRegion(this.dungeon.encounter.regions.combat, player)) damage(player, Number.MAX_SAFE_INTEGER);
    const active = players.filter(player => this.isActiveParticipant(player.id) && player.hp > 0);
    if (!active.length) { this.fail(world); return; }

    const targets = active.filter(player => insideDungeonRegion(this.dungeon.encounter.regions.bossAggro, player));
    if (!targets.length) {
      this.targetId = undefined;
      this.windup = undefined;
      this.nextAttack = Math.max(this.nextAttack, now + 250);
      this.resetPath();
      this.resetStallTimer();
      return;
    }

    boss.effects = boss.effects.filter(effect => effect.until > now);
    if (this.windup) { this.resetStallTimer(); this.resolveWindup(now, active, world, damage); return; }
    const target = this.chooseTarget(targets);
    const distance = Math.hypot(target.x - boss.x, target.y - boss.y);
    const seesTarget = hasLineOfSight(boss, target, world);
    if (distance > this.definition.behavior.preferredRange && this.chase(target, seesTarget, now, dt, world)) return;
    boss.aim = Math.atan2(target.y - boss.y, target.x - boss.x);
    if (now < this.nextAttack || !seesTarget) return;
    const attack = this.chooseAttack(distance);
    if (!attack) return;
    this.beginAttack(attack, target, now, distance, damage);
    this.attackIndex++;
  }

  private beginAttack(attack: BossAttackDefinition, target: Actor, now: number, distance: number, damage: (target: Actor, amount: number) => void): void {
    const boss = this.boss;
    this.resetStallTimer();
    if (attack.kind === 'melee') {
      if (distance <= attack.range) damage(target, attack.damage);
      this.nextAttack = now + this.cooldown(attack);
      return;
    }
    const windup: BossWindup = { bossId: this.definition.id, kind: attack.kind, x: boss.x, y: boss.y, radius: attack.radius,
      damage: attack.damage, startedAt: now, resolvesAt: now + attack.windupMs, innerRadius: attack.innerRadius };
    if (attack.kind === 'charge') {
      const length = Math.min(attack.travel ?? 250, Math.max(115, distance + 35));
      const endpoint = this.clampToLeash({ x: boss.x + Math.cos(boss.aim) * length, y: boss.y + Math.sin(boss.aim) * length });
      windup.targetX = endpoint.x; windup.targetY = endpoint.y;
    }
    this.windup = windup;
  }

  private resolveWindup(now: number, players: Actor[], world: World, damage: (target: Actor, amount: number) => void): void {
    const windup = this.windup!;
    if (now < windup.resolvesAt) return;
    if (windup.kind === 'charge') {
      const target = { x: windup.targetX ?? windup.x, y: windup.targetY ?? windup.y };
      const dx = target.x - this.boss.x, dy = target.y - this.boss.y, start = { x: this.boss.x, y: this.boss.y };
      Object.assign(this.boss, moveWithCollisions(this.boss, dx, dy, Math.hypot(dx, dy), world));
      for (const player of players) if (segmentCircleHit(start, this.boss, player, windup.radius + player.radius) !== null) damage(player, windup.damage);
    } else {
      for (const player of players) {
        const distance = Math.hypot(player.x - windup.x, player.y - windup.y);
        if (distance > windup.radius + player.radius || distance < (windup.innerRadius ?? 0) - player.radius) continue;
        if (hasLineOfSight(windup, player, world)) damage(player, windup.damage);
      }
    }
    const attack = this.definition.attacks.find(candidate => candidate.kind === windup.kind)!;
    this.windup = undefined;
    this.nextAttack = now + this.cooldown(attack);
    this.resetPath();
  }

  /** Returns true while an anti-stuck sidestep owns movement and attacks must remain paused. */
  private chase(target: Actor, direct: boolean, now: number, dt: number, world: World): boolean {
    if (this.moveUnstuck(now, dt, world)) return true;
    if (this.pathTargetId && this.pathTargetId !== target.id) this.stalledSince = undefined;
    if (direct) this.resetPath();
    else if (now >= this.pathRefreshAt || this.pathTargetId !== target.id || !this.path.length) {
      this.path = findBossPath(this.definition, this.boss, target, world);
      this.pathTargetId = target.id;
      this.pathRefreshAt = now + this.definition.behavior.pathRefreshMs;
    }
    while (this.path.length && Math.hypot(this.path[0].x - this.boss.x, this.path[0].y - this.boss.y) < 24) this.path.shift();
    const waypoint = direct ? target : this.path[0] ?? target;
    const angle = Math.atan2(waypoint.y - this.boss.y, waypoint.x - this.boss.x);
    this.boss.aim = angle;
    const speed = this.boss.hp <= this.boss.maxHp * this.definition.enrageAt ? this.definition.enrageSpeed : 1;
    const before = { x: this.boss.x, y: this.boss.y };
    Object.assign(this.boss, moveWithCollisions(this.boss, Math.cos(angle), Math.sin(angle), movementSpeed(this.boss, now) * speed * dt, world));
    const moved = Math.hypot(this.boss.x - before.x, this.boss.y - before.y);
    const unstuck = this.definition.behavior.unstuck;
    if (!unstuck || moved > Math.max(0.6, movementSpeed(this.boss, now) * dt * 0.2)) {
      this.stalledSince = undefined;
      return false;
    }
    this.stalledSince ??= now;
    if (now - this.stalledSince < unstuck.afterMs || !this.beginUnstuck(angle, now, world)) return false;
    return this.moveUnstuck(now, dt, world);
  }

  private beginUnstuck(intendedAngle: number, now: number, world: World): boolean {
    const config = this.definition.behavior.unstuck;
    if (!config) return false;
    const intendedSector = ((Math.round(intendedAngle / (Math.PI / 4)) % 8) + 8) % 8;
    const sectors = [2, -2, 3, -3, 1, -1, 4, 0]
      .map(offset => (intendedSector + offset + 8) % 8)
      .filter(sector => sector !== this.lastUnstuckSector);
    let best: { sector: number; angle: number; distance: number } | undefined;
    for (const sector of sectors) {
      const angle = sector * Math.PI / 4;
      const candidate = moveWithCollisions(this.boss, Math.cos(angle), Math.sin(angle), config.probeDistance, world);
      if (!insideDungeonRegion(this.dungeon.encounter.regions.bossLeash, candidate, -this.definition.radius - 8)) continue;
      const distance = Math.hypot(candidate.x - this.boss.x, candidate.y - this.boss.y);
      if (distance > (best?.distance ?? 1)) best = { sector, angle, distance };
    }
    if (!best) return false;
    this.lastUnstuckSector = best.sector;
    this.unstuckAngle = best.angle;
    this.unstuckUntil = now + config.durationMs;
    this.stalledSince = undefined;
    this.resetPath();
    return true;
  }

  private moveUnstuck(now: number, dt: number, world: World): boolean {
    if (now >= this.unstuckUntil) return false;
    this.boss.aim = this.unstuckAngle;
    const distance = movementSpeed(this.boss, now) * dt;
    Object.assign(this.boss, moveWithCollisions(this.boss, Math.cos(this.unstuckAngle), Math.sin(this.unstuckAngle), distance, world));
    return true;
  }

  private cooldown(attack: BossAttackDefinition): number {
    return attack.cooldownMs * (this.boss.hp <= this.boss.maxHp * this.definition.enrageAt ? this.definition.enrageCooldown : 1);
  }
  private chooseTarget(players: Actor[]): Actor {
    const distance = (player: Actor) => Math.hypot(player.x - this.boss.x, player.y - this.boss.y);
    const behavior = this.definition.behavior.targeting;
    const target = [...players].sort((a, b) => behavior === 'nearest' ? distance(a) - distance(b)
      : behavior === 'lowest-health' ? a.hp / a.maxHp - b.hp / b.maxHp || distance(a) - distance(b)
        : (this.threat.get(b.id) ?? 0) - (this.threat.get(a.id) ?? 0) || distance(a) - distance(b))[0];
    this.targetId = target.id;
    return target;
  }
  private chooseAttack(distance: number): BossAttackDefinition | undefined {
    if (this.definition.behavior.attackSelection === 'distance') {
      const candidates = this.definition.attacks.filter(candidate => distance <= candidate.range);
      return candidates.length ? candidates[this.attackIndex % candidates.length] : undefined;
    }
    const attack = this.definition.attacks[this.attackIndex % this.definition.attacks.length];
    if (distance <= attack.range) return attack;
    return this.definition.attacks.find(candidate => candidate.kind === 'charge' && distance <= candidate.range);
  }
  private clampToLeash(point: Vec2): Vec2 {
    return clampToDungeonRegion(this.dungeon.encounter.regions.bossLeash, this.boss, point, -this.definition.radius - 14);
  }
  private placeEntrants(players: Actor[], world: World, force: boolean): void {
    players.forEach((player, index) => {
      if (!force && insideDungeonRegion(this.dungeon.encounter.regions.admission, player)
        && !collidesWorld(player.x, player.y, player.radius, world)) return;
      const column = index - (players.length - 1) / 2;
      const spawn = this.dungeon.spawnPoints.boss;
      const staging = this.dungeon.spawnPoints.party[index]
        ?? { x: spawn.x + column * 48, y: spawn.y + 205 };
      if (!collidesWorld(staging.x, staging.y, player.radius, world)) Object.assign(player, staging);
    });
  }
  private beginEncounter(leader: Actor, entrants: Actor[], now: number, world: World, stageTeam: boolean): void {
    this.ownerId = leader.id;
    this.resetStallTimer();
    this.lastUnstuckSector = -1;
    this.preparationEntrants = 0;
    this.preparedIds.clear();
    this.eliminatedIds.clear();
    for (const entrant of entrants) { this.participantIds.add(entrant.id); this.threat.set(entrant.id, 0); }
    this.nextAttack = Math.max(this.nextAttack, now + 500);
    world.setBossLocked(this.definition.id, true);
    this.placeEntrants(entrants, world, stageTeam);
  }
  private cancelPreparation(): void { this.preparation = undefined; this.preparationEntrants = 0; this.preparedIds.clear(); }
  private eject(player: Actor): void {
    Object.assign(player, this.dungeon.encounter.ejectTo);
  }
  private fail(world: World): void { this.resetFight(); this.unlock(world); }
  private resetFight(): void {
    Object.assign(this.boss, { ...this.dungeon.spawnPoints.boss, hp: this.definition.hp, effects: [] });
    this.windup = undefined; this.nextAttack = 0; this.attackIndex = 0; this.resetPath(); this.resetStallTimer(); this.lastUnstuckSector = -1;
  }
  private unlock(world: World): void {
    this.ownerId = undefined; this.targetId = undefined; this.cancelPreparation(); this.participantIds.clear(); this.eliminatedIds.clear(); this.threat.clear();
    world.setBossLocked(this.definition.id, false);
  }
  private resetPath(): void { this.path = []; this.pathTargetId = undefined; this.pathRefreshAt = 0; }
  private resetStallTimer(): void { this.stalledSince = undefined; this.unstuckUntil = 0; }
  private save(): void { this.store?.touch(); this.store?.flush(); }
}

/** Bounded A* constrained by the map-authored boss leash region. */
export function findBossPath(definition: BossDefinition, start: Vec2, goal: Vec2, world: World): Vec2[] {
  const dungeon = DUNGEON_BY_ID.get(definition.dungeonId);
  if (!dungeon) return [];
  const toTile = (point: Vec2) => ({ tx: Math.floor(point.x / 48), ty: Math.floor(point.y / 48) });
  const center = (tx: number, ty: number): Vec2 => ({ x: tx * 48 + 24, y: ty * 48 + 24 });
  const valid = (tx: number, ty: number): boolean => {
    const point = center(tx, ty);
    return insideDungeonRegion(dungeon.encounter.regions.bossLeash, point, -definition.radius - 12)
      && !collidesWorld(point.x, point.y, definition.radius + 2, world);
  };
  const nearest = (point: Vec2) => {
    const base = toTile(point);
    for (let radius = 0; radius <= 3; radius++) for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === radius && valid(base.tx + dx, base.ty + dy)) return { tx: base.tx + dx, ty: base.ty + dy };
    }
    return undefined;
  };
  const from = nearest(start), to = nearest(goal);
  if (!from || !to) return [];
  const key = (tx: number, ty: number) => `${tx},${ty}`;
  const open = [{ ...from, score: 0 }], came = new Map<string, string>(), cost = new Map([[key(from.tx, from.ty), 0]]);
  const coords = new Map([[key(from.tx, from.ty), from]]);
  for (let visited = 0; open.length && visited < 500; visited++) {
    open.sort((a, b) => a.score - b.score);
    const current = open.shift()!;
    if (current.tx === to.tx && current.ty === to.ty) {
      const result: Vec2[] = []; let cursor = key(to.tx, to.ty);
      while (cursor !== key(from.tx, from.ty)) { const node = coords.get(cursor)!; result.unshift(center(node.tx, node.ty)); cursor = came.get(cursor)!; }
      return smoothBossPath(definition, dungeon, start, result, world);
    }
    const baseCost = cost.get(key(current.tx, current.ty))!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const tx = current.tx + dx, ty = current.ty + dy;
      if (!valid(tx, ty)) continue;
      if (dx && dy && (!valid(current.tx + dx, current.ty) || !valid(current.tx, current.ty + dy))) continue;
      const nextKey = key(tx, ty), nextCost = baseCost + (dx && dy ? Math.SQRT2 : 1);
      if (nextCost >= (cost.get(nextKey) ?? Infinity)) continue;
      cost.set(nextKey, nextCost); came.set(nextKey, key(current.tx, current.ty)); coords.set(nextKey, { tx, ty });
      const hx = Math.abs(to.tx - tx), hy = Math.abs(to.ty - ty);
      open.push({ tx, ty, score: nextCost + Math.max(hx, hy) + (Math.SQRT2 - 1) * Math.min(hx, hy) });
    }
  }
  return [];
}

/** Removes grid zig-zags only when the boss-sized circle can safely sweep the shortcut. */
function smoothBossPath(definition: BossDefinition, dungeon: DungeonDefinition, start: Vec2, path: Vec2[], world: World): Vec2[] {
  const clear = (from: Vec2, to: Vec2): boolean => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y), steps = Math.max(1, Math.ceil(distance / 12));
    for (let step = 1; step <= steps; step++) {
      const ratio = step / steps, x = from.x + (to.x - from.x) * ratio, y = from.y + (to.y - from.y) * ratio;
      if (!insideDungeonRegion(dungeon.encounter.regions.bossLeash, { x, y }, -definition.radius - 8)
        || collidesWorld(x, y, definition.radius + 2, world)) return false;
    }
    return true;
  };
  const smoothed: Vec2[] = [];
  let anchor = start, index = 0;
  while (index < path.length) {
    let furthest = index;
    while (furthest + 1 < path.length && clear(anchor, path[furthest + 1])) furthest++;
    smoothed.push(path[furthest]);
    anchor = path[furthest];
    index = furthest + 1;
  }
  return smoothed;
}
