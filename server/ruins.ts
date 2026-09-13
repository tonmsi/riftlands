import { randomUUID } from 'node:crypto';
import type { Actor, Vec2 } from '../shared/types';
import { RUINS, inRuins, type RuinsState, type BossWindup } from '../shared/ruins';
import { collidesWorld, hasLineOfSight, moveWithCollisions, movementSpeed, segmentCircleHit } from '../shared/physics';
import type { World } from '../shared/world';
import type { Account, AccountStore } from './store';

/** Single persistent encounter. Never owned by a generated chunk or its eviction cache. */
export class RuinsEncounter {
  readonly boss: Actor;
  readonly state: RuinsState;
  windup?: BossWindup;
  private nextAttack = 0;
  private attacks = 0;
  private path: Vec2[] = [];
  private pathTargetId?: string;
  private pathRefreshAt = 0;

  constructor(now: number, private readonly store?: AccountStore) {
    this.state = store?.ruins ?? { respawnAt: 0, corpse: { x: RUINS.x, y: RUINS.y }, drops: [] };
    if (store) store.ruins = this.state;
    const dead = this.state.respawnAt > now;
    this.boss = { id: RUINS.bossId, name: 'Custode delle Rovine', kind: 'npc', npcKind: 'warden', classId: 'warrior',
      x: dead ? this.state.corpse.x : RUINS.x, y: dead ? this.state.corpse.y : RUINS.y,
      radius: 28, hp: dead ? 0 : RUINS.hp, maxHp: RUINS.hp, resource: 0, maxResource: 100, aim: Math.PI / 2,
      speed: 100, level: 5, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0,
      deadUntil: dead ? this.state.respawnAt : 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
  }

  killed(ownerId: string | undefined, now: number): void {
    if (this.state.respawnAt > now) return;
    this.windup = undefined;
    this.resetPath();
    this.state.respawnAt = now + RUINS.respawnMs;
    this.boss.deadUntil = this.state.respawnAt;
    this.state.corpse = { x: this.boss.x, y: this.boss.y };
    this.state.drops = this.state.drops.filter(drop => drop.expiresAt > now);
    if (ownerId) this.state.drops.push({ id: randomUUID(), ownerId, amount: RUINS.gold, ...this.state.corpse, availableAt: now + 500, expiresAt: now + RUINS.lootMs });
    this.save();
  }

  collect(player: Actor, account: Account, connected: boolean, now: number): void {
    if (!connected || player.hp <= 0) return;
    const collectible = this.state.drops.filter(d => d.ownerId === player.id && d.availableAt <= now && d.expiresAt > now && Math.hypot(player.x - d.x, player.y - d.y) <= player.radius + 18);
    if (!collectible.length) return;
    const gold = (account.gold ?? 0) + collectible.reduce((sum, d) => sum + d.amount, 0);
    if (!Number.isSafeInteger(gold)) return;
    const ids = new Set(collectible.map(d => d.id));
    account.gold = gold;
    this.state.drops = this.state.drops.filter(d => !ids.has(d.id));
    // Wallet and removal are committed in the SAME atomic JSON replacement.
    this.save();
  }

  step(now: number, dt: number, players: Actor[], world: World, damage: (target: Actor, amount: number) => void): void {
    const boss = this.boss;
    if (this.state.drops.some(d => d.expiresAt <= now)) {
      this.state.drops = this.state.drops.filter(d => d.expiresAt > now);
      this.save();
    }
    if (boss.hp <= 0) {
      if (now < this.state.respawnAt) return;
      Object.assign(boss, { x: RUINS.x, y: RUINS.y, hp: RUINS.hp, deadUntil: 0, effects: [] });
      this.state.respawnAt = 0; this.nextAttack = now + 1500; this.attacks = 0; this.resetPath();
      this.save();
      return;
    }
    boss.effects = boss.effects.filter(effect => effect.until > now);
    const candidates = players.filter(p => p.hp > 0 && p.spawnProtectedUntil <= now && inRuins(p, 100));
    if (this.windup) { this.resolveWindup(now, candidates, world, damage); return; }
    // Aggro is proximity-based. Line of sight gates attacks, not target acquisition or navigation.
    const target = candidates.sort((a, b) => Math.hypot(a.x - boss.x, a.y - boss.y) - Math.hypot(b.x - boss.x, b.y - boss.y))[0];
    if (!target) {
      // Reset an abandoned encounter without creating loot or a new corpse.
      boss.x = RUINS.x; boss.y = RUINS.y; boss.hp = boss.maxHp; boss.effects = []; this.attacks = 0; this.resetPath();
      return;
    }
    const distance = Math.hypot(target.x - boss.x, target.y - boss.y);
    const seesTarget = hasLineOfSight(boss, target, world);
    if (distance > 68) this.chase(target, seesTarget, now, dt, world);
    boss.aim = Math.atan2(target.y - boss.y, target.x - boss.x);
    if (now < this.nextAttack || !seesTarget || distance > 285) return;
    const attack = this.attacks % 6;
    if (attack === 1) {
      this.windup = { kind: 'slam', x: boss.x, y: boss.y, radius: 145, startedAt: now, resolvesAt: now + 850 };
    } else if (attack === 5) {
      this.windup = { kind: 'nova', x: boss.x, y: boss.y, radius: 235, innerRadius: 82, startedAt: now, resolvesAt: now + 1100 };
    } else if (distance > 82 || attack === 3) {
      const length = Math.min(250, Math.max(115, distance + 35));
      const endpoint = clampToRuins({ x: boss.x + Math.cos(boss.aim) * length, y: boss.y + Math.sin(boss.aim) * length });
      this.windup = { kind: 'charge', x: boss.x, y: boss.y, radius: 38, startedAt: now, resolvesAt: now + 700,
        targetX: endpoint.x, targetY: endpoint.y };
    } else {
      damage(target, 18);
      this.nextAttack = now + this.cooldown();
    }
    this.attacks++;
  }

  private resolveWindup(now: number, players: Actor[], world: World, damage: (target: Actor, amount: number) => void): void {
    const windup = this.windup!;
    if (now < windup.resolvesAt) return;
    if (windup.kind === 'charge') {
      const target = { x: windup.targetX ?? windup.x, y: windup.targetY ?? windup.y };
      const dx = target.x - this.boss.x, dy = target.y - this.boss.y;
      const start = { x: this.boss.x, y: this.boss.y };
      Object.assign(this.boss, moveWithCollisions(this.boss, dx, dy, Math.hypot(dx, dy), world));
      for (const player of players) if (segmentCircleHit(start, this.boss, player, windup.radius + player.radius) !== null) damage(player, 27);
    } else {
      for (const player of players) {
        const distance = Math.hypot(player.x - windup.x, player.y - windup.y);
        if (distance > windup.radius + player.radius || distance < (windup.innerRadius ?? 0) - player.radius) continue;
        if (hasLineOfSight(windup, player, world)) damage(player, windup.kind === 'slam' ? 31 : 24);
      }
    }
    this.windup = undefined;
    this.nextAttack = now + this.cooldown();
    this.resetPath();
  }

  private chase(target: Actor, direct: boolean, now: number, dt: number, world: World): void {
    if (direct) this.resetPath();
    else if (now >= this.pathRefreshAt || this.pathTargetId !== target.id || !this.path.length) {
      this.path = findBossPath(this.boss, target, world);
      this.pathTargetId = target.id;
      this.pathRefreshAt = now + 450;
    }
    while (this.path.length && Math.hypot(this.path[0].x - this.boss.x, this.path[0].y - this.boss.y) < 18) this.path.shift();
    const waypoint = direct ? target : this.path[0] ?? target;
    const angle = Math.atan2(waypoint.y - this.boss.y, waypoint.x - this.boss.x);
    this.boss.aim = angle;
    const enrage = this.boss.hp <= this.boss.maxHp * 0.45 ? 1.24 : 1;
    Object.assign(this.boss, moveWithCollisions(this.boss, Math.cos(angle), Math.sin(angle), movementSpeed(this.boss, now) * enrage * dt, world));
  }

  private cooldown(): number { return this.boss.hp <= this.boss.maxHp * 0.45 ? 1050 : 1450; }
  private resetPath(): void { this.path = []; this.pathTargetId = undefined; this.pathRefreshAt = 0; }

  private save(): void { this.store?.touch(); this.store?.flush(); }
}

function clampToRuins(point: Vec2): Vec2 {
  const dx = point.x - RUINS.x, dy = point.y - RUINS.y, distance = Math.hypot(dx, dy), limit = RUINS.radius - 42;
  return distance <= limit ? point : { x: RUINS.x + dx / distance * limit, y: RUINS.y + dy / distance * limit };
}

/** Small bounded A* used only by the unique ruins boss when an obstacle blocks sight. */
export function findBossPath(start: Vec2, goal: Vec2, world: World): Vec2[] {
  const toTile = (point: Vec2) => ({ tx: Math.floor(point.x / 48), ty: Math.floor(point.y / 48) });
  const center = (tx: number, ty: number): Vec2 => ({ x: tx * 48 + 24, y: ty * 48 + 24 });
  const valid = (tx: number, ty: number): boolean => {
    const point = center(tx, ty);
    return Math.abs(point.x - RUINS.x) <= 470 && Math.abs(point.y - RUINS.y) <= 430 && !collidesWorld(point.x, point.y, 30, world);
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
      const result: Vec2[] = [];
      let cursor = key(to.tx, to.ty);
      while (cursor !== key(from.tx, from.ty)) {
        const node = coords.get(cursor)!; result.unshift(center(node.tx, node.ty));
        cursor = came.get(cursor)!;
      }
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
