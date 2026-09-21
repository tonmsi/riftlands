import test from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_BY_ID } from '../shared/bosses';
import { DUNGEON_DEFINITIONS, dungeonEncounters, dungeonAt, dungeonAtTile, dungeonTile, dungeonFlames, dungeonStoneTiles, isClosedDungeonTile, assertValidDungeonDefinition, flameBarrierFromTiles, inwardFlameAngle } from '../shared/dungeons';
import { World } from '../shared/world';
import { insideDungeonRegion } from '../shared/dungeons';
import { DungeonPlaytestWorld } from '../client/dungeon-playtest';
import { moveWithCollisions } from '../shared/physics';
import { WorldSimulation } from '../server/simulation';
import { engineBundle, registerEngineBundle } from './fixtures/dungeon-engine';

function setup() {
    const bundle = engineBundle();
    bundle.definition.passages = bundle.definition.passages.map(p => p.fightState === 'open' ? { ...p, fightState: 'stone' as const } : p);
    return { bundle, definition: bundle.definition, cleanup: registerEngineBundle(bundle) };
}

test('room stones seal only walkable exits and stop movement before the death zone', () => {
    const d = engineBundle().definition, b = d.layout.bounds;
    const room = (left: number, right: number) => ({ kind: 'polygon' as const, points: [
        {x:(b.minTx+left)*48,y:(b.minTy+3)*48}, {x:(b.minTx+right)*48,y:(b.minTy+3)*48},
        {x:(b.minTx+right)*48,y:(b.minTy+14)*48}, {x:(b.minTx+left)*48,y:(b.minTy+14)*48},
    ] });
    d.encounter.regions.combat = room(4,11);
    d.layout.tiles = d.layout.tiles!.map(t => ({...t, kind: t.x === b.minTx+3 ? 'water' as const
        : t.x === b.minTx+10 && t.y === b.minTy+8 ? 'rock' as const : 'path' as const}));
    d.additionalEncounters = [{bossId:'second-room',encounterGroupId:'second',spawnPoints:d.spawnPoints,
        passages:d.passages,encounter:{...d.encounter,regions:{...d.encounter.regions,combat:room(14,21)}}}];
    const stones = dungeonStoneTiles(d), world = new DungeonPlaytestWorld(d);
    assert.ok(stones.length > 0);
    assert.ok(stones.every(t => dungeonTile(d,t.x,t.y) === 'path'));
    assert.ok(stones.every(t => insideDungeonRegion(d.encounter.regions.combat,{x:(t.x+.5)*48,y:(t.y+.5)*48})));
    assert.ok(!stones.some(t=>t.x===b.minTx+4 && t.y===b.minTy+8), 'water already blocks this exit');
    const exit = {x:b.minTx+10,y:b.minTy+7}, other = {x:b.minTx+20,y:b.minTy+7};
    world.setBossLocked(d.bossId,true);
    assert.equal(world.getTile(exit.x,exit.y),'rock');
    assert.equal(world.getTile(other.x,other.y),'path','the next room stays open');
    assert.equal(world.getTile(b.minTx+3,b.minTy+8),'water');
    const stopped = moveWithCollisions({x:(b.minTx+9.5)*48,y:(b.minTy+7.5)*48,radius:15},1,0,500,world);
    assert.ok(insideDungeonRegion(d.encounter.regions.combat,stopped,-48), 'a safe margin remains before death');
    world.setBossLocked('second-room',true);
    world.setBossLocked(d.bossId,false);
    assert.equal(world.getTile(exit.x,exit.y),'path');
    assert.equal(world.getTile(other.x,other.y),'rock');
});

test('authored dungeon catalog has unique IDs and matching bosses', t => {
    const f = setup(); t.after(f.cleanup);
    const encounters = DUNGEON_DEFINITIONS.flatMap(dungeonEncounters);
    assert.equal(new Set(encounters.map(d => d.bossId)).size, encounters.length);
    for (const d of encounters) { assert.equal(BOSS_BY_ID.get(d.bossId)?.dungeonId, d.id); assert.doesNotThrow(() => assertValidDungeonDefinition(d)); }
    assert.deepEqual([...new WorldSimulation().bosses.keys()], encounters.map(d => d.bossId));
});

test('authored layout and locked passages use a shared geometry', t => {
    const f = setup(); t.after(f.cleanup);
    const d = f.definition, world = new World(), stone = dungeonStoneTiles(d)[0], flame = d.passages.find(p => p.fightState === 'flame')!.tiles[0];
    assert.equal(dungeonAt(d.area), d);
    assert.equal(dungeonAtTile(stone.x, stone.y), d);
    assert.equal(dungeonTile(d, stone.x, stone.y), 'path');
    assert.equal(world.getTile(stone.x, stone.y), 'path');
    world.setBossLocked(d.bossId, true);
    assert.equal(world.getTile(stone.x, stone.y), 'rock');
    assert.equal(world.getTile(flame.x, flame.y), 'path');
    assert.equal(isClosedDungeonTile(stone.x, stone.y, new Set([d.bossId])), true);
    assert.equal(isClosedDungeonTile(stone.x, stone.y, new Set()), false);
});

test('validation rejects overlapping passages and undeclared boundary openings', () => {
    const d = engineBundle().definition, flame = d.passages.find(p => p.fightState === 'flame')!;
    assert.throws(() => assertValidDungeonDefinition({ ...d, passages: [...d.passages, { ...flame, id: 'conflict', fightState: 'stone' }] }), /condividono|sovrappongono/);
    assert.throws(() => assertValidDungeonDefinition({ ...d, passages: d.passages.filter(p => !p.id.startsWith('opening-')) }), /apertura|bordo/);
    assert.equal(dungeonFlames(d).length, 1);
});

test('flame tips face the map interior on all four sides and either half, without changing collision geometry', () => {
    for (const origin of [0, -200]) {
        const bounds = { minTx: origin, maxTx: origin + 19, minTy: origin, maxTy: origin + 19 };
        for (const [x,y,vertical,nx,ny] of [[1,1,false,0,1],[18,18,false,0,-1],[9,8,false,0,1],[9,11,false,0,-1],[1,1,true,1,0],[18,18,true,-1,0],[8,9,true,1,0],[11,9,true,-1,0]] as const) {
            const flame = flameBarrierFromTiles([{ x: origin+x, y: origin+y }], vertical), before = { ...flame };
            const angle = inwardFlameAngle(flame, bounds);
            assert.ok(Math.abs(-Math.sin(angle)-nx) < 1e-8);
            assert.ok(Math.abs(Math.cos(angle)-ny) < 1e-8);
            assert.deepEqual(flame,before);
        }
    }
});
