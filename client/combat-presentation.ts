import { CLASSES, INTEREST_RADIUS } from '../shared/config';
import { inOutpost } from '../shared/outpost';
import { hasLineOfSight } from '../shared/physics';
import { sweptWorldHit } from '../shared/projectiles';
import type { AbilityDef, AbilitySlot, Actor, GameEvent, InputCommand, Projectile, Snapshot } from '../shared/types';
import type { World } from '../shared/world';
interface Shot {
    visual: Projectile;
    fresh: boolean;
    hidden: boolean;
    lastAt: number;
    authority?: {
        projectile: Projectile;
        time: number;
    };
}
interface Cast {
    seq: number;
    slot: AbilitySlot;
    ability: AbilityDef;
    requestedAt: number;
    event: GameEvent;
    presentedAt?: number;
    confirmed: boolean;
    rejected: boolean;
    shot?: Shot;
}
/** Cosmetic prediction only. No health, resources, cooldowns or damage are changed here. */
export class LocalCombatPresentation {
    private casts = new Map<number, Cast>();
    private shots = new Map<string, Shot>();
    private ownerId?: string;
    private previousSelf?: Actor;
    reset(): void { this.casts.clear(); this.shots.clear(); this.ownerId = undefined; this.previousSelf = undefined; }
    /** A held basic attack must not send a different cast every movement tick during cooldown. */
    basicReady(actor: Actor, now: number): boolean {
        return actor.cooldowns.basic <= now && ![...this.casts.values()].some(c => !c.rejected && c.slot === 'basic' && now < c.requestedAt + c.ability.cooldown * 1000);
    }
    predict(input: InputCommand, actor: Actor, snapshot: Snapshot | null, world: World, now: number, leadMs = 0): void {
        if (this.ownerId && this.ownerId !== actor.id)
            this.reset();
        this.ownerId = actor.id;
        if (!input.cast || actor.hp <= 0)
            return;
        const ability = CLASSES[actor.classId].abilities[input.cast];
        if (ability.kind !== 'projectile' && ability.kind !== 'melee')
            return;
        if (world.mode === 'world' && inOutpost(actor) && (actor.pvpUntil ?? 0) <= now)
            return;
        this.prune(now);
        const reservations = [...this.casts.values()].filter(c => !c.rejected);
        const executionTime = now + Math.max(0, Math.min(150, leadMs));
        if (actor.cooldowns[input.cast] > executionTime || reservations.some(c => c.slot === input.cast && executionTime < c.requestedAt + c.ability.cooldown * 1000)
            || actor.resource - reservations.filter(c => !c.confirmed).reduce((sum, c) => sum + c.ability.cost, 0) < ability.cost)
            return;
        let aim = input.aim;
        if (input.autoAim) {
            const eligible = (target: Actor) => target.id !== actor.id && target.hp > 0 && (!actor.teamId || target.teamId !== actor.teamId)
                && target.spawnProtectedUntil <= now && Math.hypot(target.x - actor.x, target.y - actor.y) < INTEREST_RADIUS
                && !(world.mode === 'world' && target.kind === 'player' && inOutpost(target) && (target.pvpUntil ?? 0) <= now)
                && (!target.bossKey || snapshot?.bossLocks?.some(lock => lock.bossId === target.bossKey && lock.relation === 'participant'))
                && hasLineOfSight(actor, target, world);
            const candidates = (snapshot?.actors ?? []).filter(eligible);
            const target = input.targetId ? candidates.find(a => a.id === input.targetId)
                : candidates.sort((a, b) => Math.hypot(a.x - actor.x, a.y - actor.y) - Math.hypot(b.x - actor.x, b.y - actor.y))[0];
            if (target)
                aim = Math.atan2(target.y - actor.y, target.x - actor.x);
        }
        const event: GameEvent = { id: `local-cast:${actor.id}:${input.seq}`, inputSeq: input.seq, kind: 'cast', actorId: actor.id,
            x: actor.x, y: actor.y, aim, at: now, duration: 380, radius: ability.radius, color: ability.color, abilityKind: ability.kind, text: ability.name };
        const cast: Cast = { seq: input.seq, slot: input.cast, ability, requestedAt: executionTime, event, confirmed: false, rejected: false };
        if (ability.kind === 'projectile') {
            const speed = ability.speed ?? 400;
            cast.shot = { visual: { id: `local-shot:${actor.id}:${input.seq}`, inputSeq: input.seq, ownerId: actor.id, x: actor.x, y: actor.y,
                    vx: Math.cos(aim) * speed, vy: Math.sin(aim) * speed, radius: ability.radius, color: ability.color, damage: 0, expiresAt: now + ability.range / speed * 1000 }, fresh: true, hidden: false, lastAt: now };
        }
        this.casts.set(input.seq, cast);
    }
    receive(snapshot: Snapshot, now: number): void {
        const self = snapshot.self;
        if ((this.ownerId && this.ownerId !== self.id) || (this.previousSelf && (this.previousSelf.classId !== self.classId
            || (this.previousSelf.hp <= 0) !== (self.hp <= 0) || Math.hypot(self.x - this.previousSelf.x, self.y - this.previousSelf.y) > 250)))
            this.reset();
        this.ownerId = self.id;
        this.previousSelf = self;
        const events = new Map(snapshot.events.filter(e => e.kind === 'cast' && e.actorId === self.id && e.inputSeq !== undefined).map(e => [e.inputSeq!, e]));
        const own = snapshot.projectiles.filter(p => p.ownerId === self.id), live = new Set(own.map(p => p.id));
        // A held button can be accepted on a later command than the client's cooldown estimate.
        // Anchor that launch too, rather than exposing a delayed, already displaced first sample.
        for (const [seq, event] of events)
            if (!this.casts.has(seq) && event.at + event.duration >= now
                && (event.abilityKind === 'projectile' || event.abilityKind === 'melee')) {
                const slot = (Object.keys(CLASSES[self.classId].abilities) as AbilitySlot[]).find(s => CLASSES[self.classId].abilities[s].name === event.text);
                if (!slot)
                    continue;
                const cast: Cast = { seq, slot, ability: CLASSES[self.classId].abilities[slot], requestedAt: event.at, event: { ...event }, confirmed: true, rejected: false };
                const projectile = own.find(p => p.inputSeq === seq);
                if (projectile)
                    cast.shot = { visual: { ...projectile }, fresh: true, hidden: false, lastAt: now };
                this.casts.set(seq, cast);
            }
        for (const cast of this.casts.values())
            if (!cast.confirmed && !cast.rejected && cast.seq <= snapshot.ack) {
                const event = events.get(cast.seq);
                cast.confirmed = !!event || own.some(p => p.inputSeq === cast.seq);
                cast.rejected = !cast.confirmed;
                if (event) {
                    cast.event.aim = event.aim;
                    cast.event.radius = event.radius;
                    cast.requestedAt = event.at;
                }
                // Accepted and already impacted before the snapshot, or rejected by cooldown/resources.
                if (cast.shot && (cast.rejected || !own.some(p => p.inputSeq === cast.seq)))
                    cast.shot.hidden = true;
            }
        for (const [id, shot] of this.shots)
            if (!live.has(id)) {
                shot.hidden = true;
                this.shots.delete(id);
            }
        for (const projectile of own) {
            const cast = projectile.inputSeq !== undefined ? this.casts.get(projectile.inputSeq) : undefined;
            let shot = this.shots.get(projectile.id) ?? cast?.shot;
            if (!shot)
                shot = { visual: { ...projectile }, fresh: false, hidden: false, lastAt: now };
            // An auto-aim correction may select a clear authoritative path after a speculative wall hit.
            if (shot.hidden && !shot.authority && cast?.confirmed) {
                shot.visual = { ...projectile };
                shot.hidden = false;
                shot.fresh = false;
            }
            shot.authority = { projectile, time: snapshot.time };
            this.shots.set(projectile.id, shot);
        }
        this.prune(now);
    }
    sample(self: Actor | null, remoteProjectiles: Projectile[], events: GameEvent[], world: World, now: number): {
        projectiles: Projectile[];
        events: GameEvent[];
    } {
        if (!self)
            return { projectiles: remoteProjectiles, events };
        this.prune(now);
        const visibleEvents = events.filter(e => !(e.kind === 'cast' && e.actorId === self.id && e.inputSeq !== undefined && this.casts.has(e.inputSeq)))
            .map(e => e.kind === 'cast' && e.actorId === self.id && e.abilityKind === 'melee' && self.hp > 0 ? { ...e, x: self.x, y: self.y } : e);
        for (const cast of this.casts.values()) {
            if (cast.rejected || self.hp <= 0)
                continue;
            if (cast.presentedAt === undefined) {
                cast.presentedAt = now;
                Object.assign(cast.event, { x: self.x, y: self.y, at: now });
                if (cast.shot?.fresh) {
                    Object.assign(cast.shot.visual, { x: self.x, y: self.y, expiresAt: now + cast.ability.range / (cast.ability.speed ?? 400) * 1000 });
                    cast.shot.lastAt = now;
                }
            }
            if (now <= cast.event.at + cast.event.duration)
                visibleEvents.push(cast.ability.kind === 'melee' ? { ...cast.event, x: self.x, y: self.y } : { ...cast.event });
        }
        const projectiles = remoteProjectiles.filter(p => p.ownerId !== self.id);
        const tracks = new Set([...this.shots.values(), ...[...this.casts.values()].flatMap(c => c.shot ? [c.shot] : [])]);
        for (const shot of tracks) {
            const p = shot.visual, auth = shot.authority;
            if (shot.hidden || now > (auth?.projectile.expiresAt ?? p.expiresAt))
                continue;
            const dt = Math.max(0, Math.min(.1, (now - shot.lastAt) / 1000));
            shot.lastAt = now;
            if (!shot.fresh) {
                let x = p.x + p.vx * dt, y = p.y + p.vy * dt;
                if (auth) {
                    // Bounded owner-only extrapolation. Remote players retain the shared interpolation buffer.
                    const ahead = Math.max(0, Math.min(100, now - auth.time)) / 1000, weight = 1 - Math.exp(-dt / 0.08);
                    const target = { x: auth.projectile.x + auth.projectile.vx * ahead, y: auth.projectile.y + auth.projectile.vy * ahead };
                    const wall = sweptWorldHit(auth.projectile, target, p.radius, world);
                    if (wall !== null) {
                        target.x = auth.projectile.x + (target.x - auth.projectile.x) * wall;
                        target.y = auth.projectile.y + (target.y - auth.projectile.y) * wall;
                    }
                    x += (target.x - x) * weight;
                    y += (target.y - y) * weight;
                    p.vx = auth.projectile.vx;
                    p.vy = auth.projectile.vy;
                }
                if (sweptWorldHit(p, { x, y }, p.radius, world) !== null) {
                    shot.hidden = true;
                    continue;
                }
                p.x = x;
                p.y = y;
            }
            shot.fresh = false;
            projectiles.push({ ...p });
        }
        return { projectiles, events: visibleEvents };
    }
    private prune(now: number): void {
        for (const [seq, cast] of this.casts)
            if (now - cast.requestedAt > Math.max(5000, cast.ability.cooldown * 1000))
                this.casts.delete(seq);
        while (this.casts.size > 128)
            this.casts.delete(this.casts.keys().next().value!);
        for (const [id, shot] of this.shots)
            if (now > (shot.authority?.projectile.expiresAt ?? shot.visual.expiresAt))
                this.shots.delete(id);
    }
}
