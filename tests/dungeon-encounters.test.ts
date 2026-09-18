import test from 'node:test';
import assert from 'node:assert/strict';
import { newDungeonDraft, compileDungeonDraft, parseDungeonDraft, validateDungeonDraft, draftFromDungeon } from '../shared/dungeon-draft';
import { buildDungeonBundle } from '../shared/dungeon-install';
import { BOSS_BY_ID, RUINS_WARDEN, MAZE_STALKER } from '../shared/bosses';
import { DUNGEON_BY_BOSS_ID, DUNGEON_DEFINITIONS, dungeonEncounters, dungeonFlames, type DungeonDefinition } from '../shared/dungeons';
import { WorldSimulation } from '../server/simulation';
import type { Actor } from '../shared/types';
function ready(separate = false) {
    const draft = newDungeonDraft(32, 20);
    draft.id = 'test-encounters';
    draft.tiles[10 * draft.width] = 'path';
    draft.encounters = separate ? [
        { id: 'first', name: 'Primo', x: 1, y: 1, width: 13, height: 18 },
        { id: 'second', name: 'Secondo', x: 17, y: 1, width: 14, height: 18 },
    ] : [{ id: 'first', name: 'Insieme', x: 1, y: 1, width: 30, height: 18 }];
    draft.entities = [
        { id: 'a', kind: 'boss', template: RUINS_WARDEN.id, label: 'A', x: 8, y: 7, level: 1, radius: 28, encounterId: 'first' },
        { id: 'b', kind: 'boss', template: MAZE_STALKER.id, label: 'B', x: 24, y: 7, level: 1, radius: 28, encounterId: separate ? 'second' : 'first' },
        { id: 'p', kind: 'party', template: '', label: 'P', x: 5, y: 12, level: 1, radius: 15, encounterId: 'first' },
        { id: 'fire', kind: 'flame', template: '', label: 'Fiamme', x: 2, y: 10, level: 1, radius: 15, encounterId: 'first', span: 3, vertical: true },
    ];
    if (separate)
        draft.entities.push({ id: 'p2', kind: 'party', template: '', label: 'P2', x: 20, y: 12, level: 1, radius: 15, encounterId: 'second' });
    return draft;
}
function fixture(separate = false) {
    const draft = ready(separate), bundle = buildDungeonBundle(draft);
    (DUNGEON_DEFINITIONS as DungeonDefinition[]).push(bundle.definition);
    for (const d of dungeonEncounters(bundle.definition))
        DUNGEON_BY_BOSS_ID.set(d.bossId, d);
    for (const b of bundle.bosses)
        BOSS_BY_ID.set(b.id, b);
    const sim = new WorldSimulation(734291, 1000000);
    const player = sim.addPlayer({ id: 'tester', name: 'Tester', nameLower: 'tester', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 }, 'warrior');
    Object.assign(player, bundle.definition.spawnPoints.party[0], { spawnProtectedUntil: 0 });
    sim.step();
    const encounters = bundle.bosses.map(b => sim.bosses.get(b.id)!);
    const kill = (target: Actor) => (sim as unknown as {
        damage(t: Actor, a: Actor, n: number): boolean;
    }).damage(target, player, 100000);
    const cleanup = () => { (DUNGEON_DEFINITIONS as DungeonDefinition[]).pop(); for (const b of bundle.bosses) {
        BOSS_BY_ID.delete(b.id);
        DUNGEON_BY_BOSS_ID.delete(b.id);
    } };
    return { sim, player, encounters, kill, cleanup, bundle };
}
test('multi-boss completion keeps both barriers locked and defers gold and XP until the last boss dies', () => {
    const f = fixture();
    try {
        const [a, b] = f.encounters;
        assert.equal(a.ownerId, f.player.id);
        assert.equal(b.ownerId, f.player.id);
        assert.equal(f.kill(a.boss), true);
        assert.equal(a.boss.hp, 0);
        assert.equal(a.state.drops.length, 0);
        assert.equal(f.player.xp, 0);
        f.sim.step();
        assert.equal(a.boss.hp, 0);
        assert.equal(a.lockState().locked, true);
        assert.equal(b.lockState().locked, true);
        f.kill(b.boss);
        assert.equal(a.lockState().locked, false);
        assert.equal(b.lockState().locked, false);
        assert.equal(a.state.drops.length, 1);
        assert.equal(b.state.drops.length, 1);
        assert.equal(a.state.respawnAt, b.state.respawnAt);
        assert.ok(f.player.xp > 0);
    }
    finally {
        f.cleanup();
    }
});
test('wipe after a partial kill resets every linked boss with no repeatable reward', () => {
    const f = fixture();
    try {
        const [a, b] = f.encounters;
        f.kill(a.boss);
        f.player.hp = 0;
        f.player.deadUntil = f.sim.now + 5000;
        f.sim.step();
        assert.equal(a.boss.hp, a.boss.maxHp);
        assert.equal(b.boss.hp, b.boss.maxHp);
        assert.equal(a.state.drops.length, 0);
        assert.equal(f.player.xp, 0);
        assert.equal(a.lockState().locked, false);
    }
    finally {
        f.cleanup();
    }
});
test('independent encounters activate and finish independently in the same physical map', () => {
    const f = fixture(true);
    try {
        const [a, b] = f.encounters;
        assert.equal(a.lockState().locked, true);
        assert.equal(b.lockState().locked, false);
        f.kill(a.boss);
        assert.equal(a.state.drops.length, 1);
        assert.equal(b.boss.hp, b.boss.maxHp);
        Object.assign(f.player, b.dungeon.spawnPoints.party[0]);
        f.sim.step();
        assert.equal(b.lockState().locked, true);
        assert.equal(a.lockState().locked, false);
    }
    finally {
        f.cleanup();
    }
});
test('roundtrip preserves encounter assignments, flame geometry and all boss placements', () => {
    const draft = ready(true);
    assert.deepEqual(parseDungeonDraft(JSON.stringify(draft)), draft);
    const compiled = compileDungeonDraft(draft), encounters = dungeonEncounters(compiled.definition);
    assert.equal(encounters.length, 2);
    assert.equal(dungeonFlames(encounters[0])[0].length, 144);
    assert.equal(dungeonFlames(encounters[1]).length, 0);
    const copied = draftFromDungeon(compiled.definition);
    assert.equal(copied.entities.filter(e => e.kind === 'boss').length, 2);
    assert.equal(copied.encounters.length, 2);
    assert.equal(copied.entities.find(e => e.kind === 'flame')?.span, 3);
});
test('installer rejects placeholders, inaccessible maps, collisions and duplicate IDs', () => {
    const draft = ready();
    draft.entities[0].template = '';
    assert.throws(() => buildDungeonBundle(draft), /segnaposto/);
    draft.entities[0].template = RUINS_WARDEN.id;
    draft.tiles[10 * draft.width] = 'rock';
    assert.throws(() => buildDungeonBundle(draft), /bordo/);
    draft.tiles[10 * draft.width] = 'path';
    const bundle = buildDungeonBundle(draft);
    assert.throws(() => buildDungeonBundle(draft, [bundle.definition]), /ID dungeon/);
    draft.id = 'different';
    assert.throws(() => buildDungeonBundle(draft, [bundle.definition]), /sovrapposta/);
    const invalid = ready(true);
    invalid.encounters[1].x = 10;
    assert.ok(validateDungeonDraft(invalid).some(s => s.includes('sovrapposte')));
});
