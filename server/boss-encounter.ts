import { randomUUID } from 'node:crypto';
import type { Actor, Vec2 } from '../shared/types';
import type { BossAttackDefinition, BossDefinition, BossLockState, BossState, BossWindup } from '../shared/bosses';
import { insideBossArena, insideBossEntry } from '../shared/bosses';
import { collidesWorld, hasLineOfSight, moveWithCollisions, movementSpeed, segmentCircleHit } from '../shared/physics';
import type { World } from '../shared/world';
import type { Account, AccountStore } from './store';

/** Shared runtime for data-defined bosses. Unique mechanics can extend this class later without duplicating its lifecycle. */
export class BossEncounter {
  readonly boss: Actor;
  readonly state: BossState;
  windup?: BossWindup;
  ownerId?: string;
  private nextAttack = 0;
  private attackIndex = 0;
  private path: Vec2[] = [];
  private pathTargetId?: string;
  private pathRefreshAt = 0;

  constructor(readonly definition: BossDefinition, now: number, state: BossState | undefined, private readonly store?: AccountStore) {
    this.state = state ?? { respawnAt: 0, corpse: { ...definition.position }, drops: [] };
    const dead = this.state.respawnAt > now;
    this.boss = {
      id: definition.id, bossKey: definition.id, bossSkin: definition.skin, name: definition.name, kind: 'npc', npcKind: 'boss', classId: definition.classId,
      x: dead ? this.state.corpse.x : definition.position.x, y: dead ? this.state.corpse.y : definition.position.y,
      radius: definition.radius, hp: dead ? 0 : definition.hp, maxHp: definition.hp, resource: 0, maxResource: 100, aim: Math.PI / 2,
      speed: definition.speed, level: definition.level, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0,
      deadUntil: dead ? this.state.respawnAt : 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 },
    };
  }

  lockState(): BossLockState { return { bossId: this.definition.id, locked: !!this.ownerId, ...(this.ownerId ? { ownerId: this.ownerId } : {}) }; }
  canDamage(attacker: Actor | undefined): boolean { return !!attacker && attacker.kind === 'player' && attacker.id === this.ownerId; }

  killed(ownerId: string | undefined, now: number, world: World): void {
    if (this.state.respawnAt > now || ownerId !== this.ownerId) return;
    this.windup = undefined;
    this.resetPath();
    this.state.respawnAt = now + this.definition.respawnMs;
    this.boss.deadUntil = this.state.respawnAt;
    this.state.corpse = { x: this.boss.x, y: this.boss.y };
    this.state.drops = this.state.drops.filter(drop => drop.expiresAt > now);
    if (ownerId) this.state.drops.push({ id: randomUUID(), bossId: this.definition.id, ownerId, amount: this.definition.reward.gold,
      ...this.state.corpse, availableAt: now + 500, expiresAt: now + this.definition.reward.lootMs });
    this.ownerId = undefined;
    world.setBossLocked(this.definition.id, false);
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
      Object.assign(boss, { ...this.definition.position, hp: this.definition.hp, deadUntil: 0, effects: [] });
      this.state.respawnAt = 0; this.nextAttack = now + 1500; this.attackIndex = 0; this.resetPath();
      this.save();
      return;
    }

    let owner = this.ownerId ? players.find(player => player.id === this.ownerId) : undefined;
    if (this.ownerId && (!owner || owner.hp <= 0)) {
      this.fail(world);
      return;
    }
    if (!owner) {
      owner = players.find(player => player.hp > 0 && connected(player.id) && insideBossEntry(this.definition, player));
      if (!owner) { this.resetFight(); return; }
      this.ownerId = owner.id;
      world.setBossLocked(this.definition.id, true);
    }
    for (const player of players) if (player.id !== owner.id && insideBossArena(this.definition, player)) this.eject(player);
    this.keepOwnerInside(owner);

    boss.effects = boss.effects.filter(effect => effect.until > now);
    if (this.windup) { this.resolveWindup(now, [owner], world, damage); return; }
    const distance = Math.hypot(owner.x - boss.x, owner.y - boss.y);
    const seesTarget = hasLineOfSight(boss, owner, world);
    if (distance > 68) this.chase(owner, seesTarget, now, dt, world);
    boss.aim = Math.atan2(owner.y - boss.y, owner.x - boss.x);
    if (now < this.nextAttack || !seesTarget) return;
    let attack = this.definition.attacks[this.attackIndex % this.definition.attacks.length];
    if (distance > attack.range) {
      const charge = this.definition.attacks.find(candidate => candidate.kind === 'charge' && distance <= candidate.range);
      if (!charge) return;
      attack = charge;
    }
    this.beginAttack(attack, owner, now, distance, damage);
    this.attackIndex++;
  }

  private beginAttack(attack: BossAttackDefinition, target: Actor, now: number, distance: number, damage: (target: Actor, amount: number) => void): void {
    const boss = this.boss;
    if (attack.kind === 'melee') {
      if (distance <= attack.range) damage(target, attack.damage);
      this.nextAttack = now + this.cooldown(attack);
      return;
    }
    const windup: BossWindup = { bossId: this.definition.id, kind: attack.kind, x: boss.x, y: boss.y, radius: attack.radius,
      damage: attack.damage, startedAt: now, resolvesAt: now + attack.windupMs, innerRadius: attack.innerRadius };
    if (attack.kind === 'charge') {
      const length = Math.min(attack.travel ?? 250, Math.max(115, distance + 35));
      const endpoint = this.clampToArena({ x: boss.x + Math.cos(boss.aim) * length, y: boss.y + Math.sin(boss.aim) * length });
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

  private chase(target: Actor, direct: boolean, now: number, dt: number, world: World): void {
    if (direct) this.resetPath();
    else if (now >= this.pathRefreshAt || this.pathTargetId !== target.id || !this.path.length) {
      this.path = findBossPath(this.definition, this.boss, target, world);
      this.pathTargetId = target.id;
      this.pathRefreshAt = now + 450;
    }
    while (this.path.length && Math.hypot(this.path[0].x - this.boss.x, this.path[0].y - this.boss.y) < 18) this.path.shift();
    const waypoint = direct ? target : this.path[0] ?? target;
    const angle = Math.atan2(waypoint.y - this.boss.y, waypoint.x - this.boss.x);
    this.boss.aim = angle;
    const speed = this.boss.hp <= this.boss.maxHp * this.definition.enrageAt ? this.definition.enrageSpeed : 1;
    Object.assign(this.boss, moveWithCollisions(this.boss, Math.cos(angle), Math.sin(angle), movementSpeed(this.boss, now) * speed * dt, world));
  }

  private cooldown(attack: BossAttackDefinition): number {
    return attack.cooldownMs * (this.boss.hp <= this.boss.maxHp * this.definition.enrageAt ? this.definition.enrageCooldown : 1);
  }
  private clampToArena(point: Vec2): Vec2 {
    const dx = point.x - this.definition.position.x, dy = point.y - this.definition.position.y;
    const distance = Math.hypot(dx, dy), limit = this.definition.arena.radius - this.definition.radius - 14;
    return distance <= limit ? point : { x: this.definition.position.x + dx / distance * limit, y: this.definition.position.y + dy / distance * limit };
  }
  private keepOwnerInside(player: Actor): void { Object.assign(player, this.clampToArena(player)); }
  private eject(player: Actor): void { Object.assign(player, this.definition.arena.exit); }
  private fail(world: World): void { this.resetFight(); this.unlock(world); }
  private resetFight(): void {
    Object.assign(this.boss, { ...this.definition.position, hp: this.definition.hp, effects: [] });
    this.windup = undefined; this.nextAttack = 0; this.attackIndex = 0; this.resetPath();
  }
  private unlock(world: World): void { this.ownerId = undefined; world.setBossLocked(this.definition.id, false); }
  private resetPath(): void { this.path = []; this.pathTargetId = undefined; this.pathRefreshAt = 0; }
  private save(): void { this.store?.touch(); this.store?.flush(); }
}

/** Bounded A* shared by every configured boss arena. */
export function findBossPath(definition: BossDefinition, start: Vec2, goal: Vec2, world: World): Vec2[] {
  const toTile = (point: Vec2) => ({ tx: Math.floor(point.x / 48), ty: Math.floor(point.y / 48) });
  const center = (tx: number, ty: number): Vec2 => ({ x: tx * 48 + 24, y: ty * 48 + 24 });
  const valid = (tx: number, ty: number): boolean => {
    const point = center(tx, ty);
    return insideBossArena(definition, point, 90) && !collidesWorld(point.x, point.y, definition.radius + 2, world);
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
      return result;
    }
    const baseCost = cost.get(key(current.tx, current.ty))!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tx = current.tx + dx, ty = current.ty + dy;
      if (!valid(tx, ty)) continue;
      const nextKey = key(tx, ty), nextCost = baseCost + 1;
      if (nextCost >= (cost.get(nextKey) ?? Infinity)) continue;
      cost.set(nextKey, nextCost); came.set(nextKey, key(current.tx, current.ty)); coords.set(nextKey, { tx, ty });
      open.push({ tx, ty, score: nextCost + Math.abs(to.tx - tx) + Math.abs(to.ty - ty) });
    }
  }
  return [];
}

