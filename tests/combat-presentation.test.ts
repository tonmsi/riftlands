import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalCombatPresentation } from '../client/combat-presentation';
import { CLASSES } from '../shared/config';
import { World } from '../shared/world';
import { WorldSimulation } from '../server/simulation';
import type { Account } from '../server/store';
import type { Actor, GameEvent, InputCommand, Projectile, Snapshot } from '../shared/types';
function fixture() {
    const world = new World(1, 10, 'battleground');
    world.getTile = () => 'grass';
    const actor: Actor = { id: 'self', name: 'Self', kind: 'player', classId: 'mage', x: 0, y: 0, radius: 15, hp: 100, maxHp: 110, resource: 120, maxResource: 120, aim: 0,
        speed: 500, level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
    const command: InputCommand = { seq: 1, dx: 1, dy: 0, aim: 0, cast: 'basic' };
    const snapshot = (ack = 0, projectiles: Projectile[] = [], events: GameEvent[] = []): Snapshot => ({ type: 'snapshot', time: 1000, tick: 1, ack, self: structuredClone(actor), actors: [], projectiles, events, pickups: [], online: 1, activeChunks: 1 });
    const view = new LocalCombatPresentation();
    return { world, actor, command, snapshot, view };
}
test('first rendered shot starts exactly on the displayed body, then flies independently at its own speed', () => {
    const { world, actor, command, view } = fixture(), before = structuredClone(actor);
    view.predict(command, actor, null, world, 1000);
    const shown = { ...actor, x: 12, y: 7 };
    const first = view.sample(shown, [], [], world, 1016);
    assert.equal(first.projectiles.length, 1);
    assert.equal(first.events.length, 1);
    assert.deepEqual({ x: first.projectiles[0].x, y: first.projectiles[0].y }, { x: 12, y: 7 });
    const next = view.sample({ ...shown, x: 28 }, [], [], world, 1048);
    assert.ok(Math.abs(next.projectiles[0].x - (12 + 480 * .032)) < 1e-8);
    assert.deepEqual(actor, before, 'cosmetic prediction must never mutate gameplay state');
    assert.equal(next.projectiles[0].damage, 0);
});
test('ACK confirms by input sequence without duplicate shots or cast events; disappearance removes the visual', () => {
    const { world, actor, command, view, snapshot } = fixture();
    view.predict(command, actor, null, world, 1000);
    const first = view.sample(actor, [], [], world, 1000);
    const projectile = { ...first.projectiles[0], id: 'server-shot', x: 40, inputSeq: 1 };
    const event = { ...first.events[0], id: 'server-event' };
    view.receive(snapshot(1, [projectile], [event]), 1050);
    const confirmed = view.sample({ ...actor, x: 25 }, [projectile], [event], world, 1050);
    assert.equal(confirmed.projectiles.length, 1);
    assert.equal(confirmed.projectiles[0].id, first.projectiles[0].id);
    assert.equal(confirmed.events.length, 1);
    assert.equal(confirmed.events[0].id, first.events[0].id);
    view.receive({ ...snapshot(1, [], [event]), time: 1100 }, 1100);
    assert.equal(view.sample(actor, [], [event], world, 1100).projectiles.length, 0);
});
test('rejected casts and casts that impact before their first snapshot do not leave ghost projectiles', () => {
    for (const accepted of [false, true]) {
        const { world, actor, command, view, snapshot } = fixture();
        view.predict(command, actor, null, world, 1000);
        const first = view.sample(actor, [], [], world, 1000), events = accepted ? [{ ...first.events[0], id: 'confirmed' }] : [];
        view.receive(snapshot(1, [], events), 1050);
        const frame = view.sample(actor, [], events, world, 1050);
        assert.equal(frame.projectiles.length, 0);
        assert.equal(frame.events.length, accepted ? 1 : 0);
    }
});
test('melee follows the body while impacts and ground areas keep their world coordinates', () => {
    const { world, actor, command, view, snapshot } = fixture();
    actor.classId = 'warrior';
    view.predict(command, actor, null, world, 1000);
    const first = view.sample(actor, [], [], world, 1000);
    const impact: GameEvent = { ...first.events[0], id: 'hit', kind: 'hit', x: 70, y: 20 };
    const area: GameEvent = { ...first.events[0], id: 'area', inputSeq: undefined, abilityKind: 'area', x: 5, y: 8 };
    const cast = { ...first.events[0], id: 'server-cast', aim: Math.PI / 2 };
    view.receive(snapshot(1, [], [cast]), 1050);
    const frame = view.sample({ ...actor, x: 25, y: 13 }, [], [cast, impact, area], world, 1080);
    const swing = frame.events.find(e => e.abilityKind === 'melee' && e.kind === 'cast')!;
    assert.equal(swing.x, 25);
    assert.equal(swing.y, 13);
    assert.equal(swing.aim, Math.PI / 2);
    assert.equal(frame.events.find(e => e.id === 'hit')?.x, 70);
    assert.equal(frame.events.find(e => e.id === 'area')?.x, 5);
});
test('cooldown, resources and sanctuary gate speculative effects without changing player resources', () => {
    const { world, actor, command, view } = fixture();
    actor.resource = 0;
    view.predict({ ...command, cast: 'q' }, actor, null, world, 1000);
    actor.cooldowns.basic = 2000;
    view.predict(command, actor, null, world, 1000);
    assert.equal(view.sample(actor, [], [], world, 1000).events.length, 0);
    actor.cooldowns.basic = 0;
    view.predict(command, actor, null, world, 1000);
    view.predict({ ...command, seq: 2 }, actor, null, world, 1033);
    assert.equal(view.sample(actor, [], [], world, 1033).events.length, 1);
    view.reset();
    view.predict(command, actor, null, new World(), 1000);
    assert.equal(view.sample(actor, [], [], world, 1000).events.length, 0);
});
test('held basic cadence uses bounded arrival time without sending extra casts during cooldown', () => {
    const { world, actor, command, view } = fixture();
    view.predict(command, actor, null, world, 1000, 150);
    assert.equal(view.basicReady(actor, 1649), false);
    assert.equal(view.basicReady(actor, 1650), true);
    actor.cooldowns.basic = 1650;
    view.predict({ ...command, seq: 2 }, actor, null, world, 1500, 150);
    const frame = view.sample(actor, [], [], world, 1500);
    assert.equal(frame.projectiles.length, 2);
    assert.equal(actor.cooldowns.basic, 1650);
});
test('speculative shots cannot tunnel through walls and reset clears all presentation state', () => {
    const { world, actor, command, view } = fixture();
    world.getTile = (x) => x === 1 ? 'rock' : 'grass';
    view.predict(command, actor, null, world, 1000);
    view.sample(actor, [], [], world, 1000);
    assert.equal(view.sample(actor, [], [], world, 1100).projectiles.length, 0);
    view.reset();
    assert.equal(view.sample(actor, [], [], world, 1100).events.length, 0);
});
test('auto aim respects explicit selection and reconciles the authoritative direction', () => {
    const { world, actor, command, view, snapshot } = fixture();
    const target = { ...actor, id: 'enemy', x: 0, y: 200 };
    const snap = snapshot();
    snap.actors = [target];
    view.predict({ ...command, autoAim: true, targetId: target.id }, actor, snap, world, 1000);
    const first = view.sample(actor, [], [], world, 1000);
    assert.ok(Math.abs(first.projectiles[0].vx) < 1e-6);
    assert.equal(first.projectiles[0].vy, 480);
    const p = { ...first.projectiles[0], id: 'server', vx: 480, vy: 0, x: 20 };
    view.receive(snapshot(1, [p], [{ ...first.events[0], aim: 0 }]), 1050);
    const corrected = view.sample(actor, [], [], world, 1066).projectiles[0];
    assert.equal(corrected.vx, 480);
    assert.equal(corrected.vy, 0);
});
test('owner shots bypass the remote buffer; remote shots retain their interpolated position', () => {
    const { world, actor, view, snapshot } = fixture();
    const p: Projectile = { id: 'owner', ownerId: actor.id, x: 50, y: 0, vx: 480, vy: 0, radius: 6, damage: 16, expiresAt: 2000, color: '#fff' };
    view.receive(snapshot(1, [p]), 1000);
    const remote = { ...p, id: 'other', ownerId: 'enemy', x: 3 };
    const frame = view.sample(actor, [{ ...p, x: 0 }, remote], [], world, 1050);
    assert.ok(frame.projectiles.find(p => p.id === 'owner')!.x > 50);
    assert.equal(frame.projectiles.find(p => p.id === 'other')!.x, 3);
});
test('a later server-accepted command also starts on the body when local cooldown prediction skipped it', () => {
    const { world, actor, view, snapshot } = fixture();
    const p: Projectile = { id: 'owner', inputSeq: 7, ownerId: actor.id, x: 70, y: 0, vx: 480, vy: 0, radius: 6, damage: 16, expiresAt: 2000, color: '#fff' };
    const e: GameEvent = { id: 'cast', inputSeq: 7, kind: 'cast', actorId: actor.id, abilityKind: 'projectile', text: CLASSES.mage.abilities.basic.name, x: 10, y: 0, aim: 0, at: 1000, duration: 380, radius: 6, color: '#fff' };
    view.receive(snapshot(7, [p], [e]), 1050);
    const shown = { ...actor, x: 33, y: 5 }, frame = view.sample(shown, [p], [e], world, 1050);
    assert.equal(frame.projectiles.length, 1);
    assert.equal(frame.projectiles[0].x, 33);
    assert.equal(frame.projectiles[0].y, 5);
    assert.equal(frame.events.length, 1);
});
test('death and room reset discard speculative swings without cancelling authoritative projectiles', () => {
    const { world, actor, view, command, snapshot } = fixture();
    view.predict(command, actor, null, world, 1000);
    view.sample(actor, [], [], world, 1000);
    const dead = { ...actor, hp: 0 };
    view.receive({ ...snapshot(1), self: dead }, 1033);
    const frame = view.sample(dead, [], [], world, 1033);
    assert.equal(frame.events.length, 0);
    assert.equal(frame.projectiles.length, 0);
    view.reset();
    view.predict(command, actor, null, world, 1100);
    assert.equal(view.sample(actor, [], [], world, 1100).projectiles.length, 1);
});
test('server echoes consumed input sequence on accepted shots and never grants damage for rejected casts', () => {
    const sim = new WorldSimulation(1, 1000, undefined, 'battleground');
    sim.world.getTile = () => 'grass';
    const account: Account = { id: 'test', name: 'Test', nameLower: 'test', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 };
    const actor = sim.addPlayer(account, 'mage');
    actor.x = 0;
    actor.y = 0;
    sim.enqueueInput(actor.id, { seq: 1, dx: 1, dy: 0, aim: 0, cast: 'basic' });
    sim.step();
    const snapshot = sim.snapshotFor(actor.id)!;
    assert.equal(snapshot.ack, 1);
    assert.equal(snapshot.events.find(e => e.kind === 'cast')?.inputSeq, 1);
    assert.equal(snapshot.projectiles[0].inputSeq, 1);
    assert.equal(snapshot.projectiles[0].damage, CLASSES.mage.abilities.basic.damage);
    sim.enqueueInput(actor.id, { seq: 2, dx: 1, dy: 0, aim: 0, cast: 'basic' });
    sim.step();
    assert.equal(sim.projectiles.size, 1);
    assert.equal(sim.events.filter(e => e.kind === 'cast').length, 1);
});
