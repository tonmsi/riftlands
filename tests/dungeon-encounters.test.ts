import test from 'node:test';
import assert from 'node:assert/strict';
import { newDungeonDraft, compileDungeonDraft, parseDungeonDraft, validateDungeonDraft, draftFromDungeon } from '../shared/dungeon-draft';
import { buildDungeonBundle } from '../shared/dungeon-install';
import { BOSS_BY_ID } from '../shared/bosses';
import { STONE_WARDEN, MAZE_STALKER } from '../shared/boss-templates';
import { DUNGEON_BY_BOSS_ID, DUNGEON_DEFINITIONS, dungeonEncounters, dungeonFlames, type DungeonDefinition } from '../shared/dungeons';
import { WorldSimulation } from '../server/simulation';
import type { Actor } from '../shared/types';
function ready(separate = false) {
    const draft = newDungeonDraft(32, 20);
    draft.id = 'test-encounters';
    while (DUNGEON_DEFINITIONS.some(d => d.id === draft.id)) draft.id += '-x';
    draft.origin.x = Math.max(100, ...DUNGEON_DEFINITIONS.map(d => d.layout.bounds.maxTx)) + 100;
    draft.tiles[10 * draft.width] = 'path';
    draft.encounters = separate ? [
        { id: 'first', name: 'Primo', x: 1, y: 1, width: 13, height: 18 },
        { id: 'second', name: 'Secondo', x: 17, y: 1, width: 14, height: 18 },
    ] : [{ id: 'first', name: 'Insieme', x: 1, y: 1, width: 30, height: 18 }];
    draft.entities = [
        { id: 'a', kind: 'boss', template: STONE_WARDEN.id, label: 'A', x: 8, y: 7, level: 1, radius: 28, encounterId: 'first' },
        { id: 'b', kind: 'boss', template: MAZE_STALKER.id, label: 'B', x: 24, y: 7, level: 1, radius: 28, encounterId: separate ? 'second' : 'first' },
        { id: 'trigger', kind: 'activation', template: '', label: 'Trigger', x: 4, y: 14, level: 1, radius: 15, encounterId: 'first' },
        { id: 'p', kind: 'party', template: '', label: 'P', x: 5, y: 12, level: 1, radius: 15, encounterId: 'first' },
        { id: 'fire', kind: 'flame', template: '', label: 'Fiamme', x: 2, y: 10, level: 1, radius: 15, encounterId: 'first', span: 3, vertical: true },
    ];
    if (separate) draft.entities.push({ id: 'trigger2', kind: 'activation', template: '', label: 'Trigger2', x: 20, y: 14, level: 1, radius: 15, encounterId: 'second' });
    if (separate)
        draft.entities.push({ id: 'p2', kind: 'party', template: '', label: 'P2', x: 20, y: 12, level: 1, radius: 15, encounterId: 'second' });
    return draft;
}
function fixture(separate = false, team = false, enterOnFlame = false) {
    const draft = ready(separate), bundle = buildDungeonBundle(draft);
    (DUNGEON_DEFINITIONS as DungeonDefinition[]).push(bundle.definition);
    for (const d of dungeonEncounters(bundle.definition))
        DUNGEON_BY_BOSS_ID.set(d.bossId, d);
    for (const b of bundle.bosses)
        BOSS_BY_ID.set(b.id, b);
    const sim = new WorldSimulation(734291, 1000000);
    const player = sim.addPlayer({ id: 'tester', name: 'Tester', nameLower: 'tester', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 }, 'warrior');
    Object.assign(player, bundle.definition.encounter.activationPoints![0], { spawnProtectedUntil: 0 });
    if (team) player.teamId = 'test-party';
    if (enterOnFlame) Object.assign(player, dungeonFlames(bundle.definition)[0]);
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
test('activation is separate from spawns and flames, and does not wake distant bosses', () => {
    const f = fixture(false, false, true);
    try {
        const e = f.encounters[0], flame = dungeonFlames(e.dungeon)[0];
        assert.equal(e.ownerId, undefined);
        Object.assign(f.player, e.dungeon.spawnPoints.party[0]);
        e.dungeon.encounter.regions.bossAggro = {kind:'circle',center:{...e.boss},radius:100};
        f.sim.step(); assert.equal(e.ownerId, undefined, 'a spawn is not a trigger');
        Object.assign(f.player, e.dungeon.encounter.activationPoints![0]); f.sim.step();
        assert.equal(e.ownerId, f.player.id);
        assert.equal(e.preparationFor(f.player), undefined);
        assert.deepEqual({ x:f.player.x,y:f.player.y },e.dungeon.spawnPoints.party[0]);
        const start = {x:e.boss.x,y:e.boss.y};
        for(let i=0;i<10;i++) f.sim.step(.1);
        assert.equal(e.targetId,undefined);
        assert.deepEqual({x:e.boss.x,y:e.boss.y},start,'flames lock without waking a distant boss');
        Object.assign(f.player,{x:e.boss.x+80,y:e.boss.y}); f.sim.step();
        assert.equal(e.targetId,f.player.id);
        Object.assign(f.player, e.dungeon.spawnPoints.party[0]); f.sim.step();
        assert.equal(e.targetId,f.player.id,'aggro persists after leaving detection radius');
        Object.assign(f.player, {x:flame.x,y:flame.y}); f.sim.step();
        assert.equal(f.player.hp,0);
    } finally { f.cleanup(); }
});

test('aggro of any linked boss starts the encounter, but never from outside combat', () => {
    const f = fixture(false,false,true);
    try {
        const [a,b] = f.encounters;
        a.dungeon.encounter.regions.bossAggro = {kind:'circle',center:{...a.boss},radius:100};
        Object.assign(f.player,{x:b.boss.x,y:b.dungeon.layout.bounds.minTy*48-30});
        f.sim.step(); assert.equal(a.ownerId,undefined);
        Object.assign(f.player,{x:b.boss.x+80,y:b.boss.y}); f.sim.step();
        assert.equal(a.ownerId,f.player.id);
        assert.equal(b.targetId,f.player.id);
        assert.equal(a.targetId,undefined,'another boss in the same encounter remains dormant');
    } finally {f.cleanup();}
});

test('only a group receives five seconds; leaving during preparation cancels the encounter', () => {
    const f = fixture(false, true);
    try {
        const e = f.encounters[0];
        assert.equal(e.ownerId, undefined);
        assert.equal(e.preparationFor(f.player)?.endsAt, f.sim.now + 5000);
        for(let i=0;i<49;i++) f.sim.step(.1);
        assert.equal(e.ownerId, undefined);
        f.sim.step(.1);
        assert.equal(e.ownerId, f.player.id);
    } finally { f.cleanup(); }
    const g = fixture(false, true);
    try {
        Object.assign(g.player, g.bundle.definition.encounter.ejectTo); g.sim.step();
        assert.equal(g.encounters[0].preparationFor(g.player), undefined);
        assert.equal(g.encounters[0].ownerId, undefined);
    } finally { g.cleanup(); }
});

test('five teammates move to five authored spawns when preparation ends', () => {
    const f = fixture(false,true);
    try {
        const e=f.encounters[0], origin=e.dungeon.spawnPoints.party[0];
        const spawns=Array.from({length:5},(_,i)=>({x:origin.x+i*48,y:origin.y}));
        e.dungeon.spawnPoints.party=spawns;
        const entrants=[f.player];
        for(let i=1;i<5;i++) {
            const player=f.sim.addPlayer({id:`member-${i}`,name:`Member${i}`,nameLower:`member${i}`,salt:'',passwordHash:'',xp:0,kills:0,deaths:0,friends:[],requests:[],lastSeen:0},'warrior');
            Object.assign(player,{x:origin.x+i*48,y:origin.y+144,teamId:f.player.teamId,spawnProtectedUntil:0});
            entrants.push(player);
        }
        for(let i=0;i<49;i++) f.sim.step(.1);
        assert.equal(e.ownerId,undefined);
        f.sim.step(.1);
        assert.equal(e.participantIds.size,5);
        assert.deepEqual(entrants.map(p=>({x:p.x,y:p.y})),spawns);
    } finally {f.cleanup();}
});

test('damaging a dormant boss engages it without requiring proximity', () => {
    const f=fixture();
    try {
        const boss=f.encounters[1];
        assert.equal(boss.targetId,undefined);
        boss.recordDamage(f.player.id,1); f.sim.step();
        assert.equal(boss.targetId,f.player.id);
    } finally {f.cleanup();}
});

test('one-tile flames preserve orientation and never inherit player entry coordinates', () => {
    for (const vertical of [false, true]) {
        const draft = ready(), fire = draft.entities.find(e => e.kind === 'flame')!;
        fire.span = 1; fire.vertical = vertical;
        const definition = compileDungeonDraft(draft).definition, flame = dungeonFlames(definition)[0];
        assert.equal(flame.angle, vertical ? Math.PI / 2 : 0);
        assert.equal(flame.x, (draft.origin.x + fire.x + .5) * 48);
        assert.equal(flame.y, (draft.origin.y + fire.y + .5) * 48);
        const copy = draftFromDungeon(definition);
        assert.equal(copy.entities.find(e => e.kind === 'flame')?.vertical, vertical);
        draft.entities.find(e => e.kind === 'party')!.x++;
        assert.deepEqual(dungeonFlames(compileDungeonDraft(draft).definition), [flame]);
    }
});

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
        Object.assign(f.player, b.dungeon.encounter.activationPoints![0]);
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
    draft.entities[0].template = STONE_WARDEN.id;
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
