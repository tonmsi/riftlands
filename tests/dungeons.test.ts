import test from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_BY_ID } from '../shared/bosses';
import {
  DUNGEON_DEFINITIONS, RUINS_DUNGEON, dungeonApproachCenter, dungeonAt, dungeonAtTile,
  assertValidDungeonDefinition, dungeonFlames, dungeonStoneTiles, dungeonTile, insideDungeon,
  isClosedDungeonTile, onDungeonApproach,
} from '../shared/dungeons';
import type { DungeonDefinition } from '../shared/dungeons';
import { World } from '../shared/world';
import { WorldSimulation } from '../server/simulation';

test('dungeon catalog has unique identities and a matching data-defined boss', () => {
  assert.equal(new Set(DUNGEON_DEFINITIONS.map(dungeon => dungeon.id)).size, DUNGEON_DEFINITIONS.length);
  assert.equal(new Set(DUNGEON_DEFINITIONS.map(dungeon => dungeon.bossId)).size, DUNGEON_DEFINITIONS.length);
  for (const dungeon of DUNGEON_DEFINITIONS) {
    const boss = BOSS_BY_ID.get(dungeon.bossId);
    assert.ok(boss);
    assert.equal(boss.dungeonId, dungeon.id);
    assert.equal(boss.dungeonId, dungeon.id);
    assert.doesNotThrow(() => assertValidDungeonDefinition(dungeon));
  }
  assert.deepEqual([...new WorldSimulation().bosses.keys()], DUNGEON_DEFINITIONS.map(dungeon => dungeon.bossId));
});

test('generic dungeon helpers derive layout, location and approach from definitions', () => {
  const synthetic: DungeonDefinition = {
    ...RUINS_DUNGEON,
    id: 'test-dungeon', bossId: 'boss:test', name: 'Test Dungeon',
    area: { x: 4800, y: 4800, radius: 100 },
    layout: {
      bounds: { minTx: 100, maxTx: 102, minTy: 100, maxTy: 102 }, floor: 'path',
      obstacles: [{ minTx: 100, maxTx: 100, minTy: 100, maxTy: 102 }],
      obstacleTiles: [{ x: 102, y: 102 }],
    },
    approach: { ...RUINS_DUNGEON.approach, from: { x: 4700, y: 4800 }, to: { x: 4300, y: 4800 }, waves: [] },
  };
  assert.equal(dungeonTile(synthetic, 101, 101), 'path');
  assert.equal(dungeonTile(synthetic, 100, 101), 'rock');
  assert.equal(dungeonTile(synthetic, 102, 102), 'rock');
  assert.equal(dungeonTile(synthetic, 99, 101), undefined);
  assert.equal(insideDungeon(synthetic, { x: 4800, y: 4850 }), true);
  assert.deepEqual(dungeonApproachCenter(synthetic, { x: 4500, y: 4800 }), { x: 4500, y: 4800 });
  assert.equal(onDungeonApproach(synthetic, { x: 4500, y: 4800 }), true);

  assert.equal(dungeonAt(RUINS_DUNGEON.area), RUINS_DUNGEON);
  assert.equal(dungeonAtTile(-4, -83), RUINS_DUNGEON);
  assert.equal(isClosedDungeonTile(-2, -74, new Set([RUINS_DUNGEON.bossId])), true);
  assert.equal(isClosedDungeonTile(-2, -74, new Set()), false);
});

test('world terrain closes only stone passages and never flame passages', () => {
  const world = new World();
  assert.equal(world.getTile(-4, -83), 'rock');
  assert.equal(world.getTile(0, -80), 'path');
  assert.equal(world.getTile(-2, -87), 'path');
  assert.equal(world.getTile(-2, -74), 'path');
  world.setBossLocked(RUINS_DUNGEON.bossId, true);
  assert.equal(world.getTile(-2, -87), 'path');
  assert.equal(world.getTile(-2, -74), 'rock');
});

test('strict schema rejects accidental flame/stone overlap and undeclared map openings', () => {
  const north = RUINS_DUNGEON.passages.find(passage => passage.id === 'north-guard')!;
  const overlap: DungeonDefinition = {
    ...RUINS_DUNGEON,
    id: 'invalid-overlap', bossId: 'boss:invalid-overlap',
    passages: [...RUINS_DUNGEON.passages, { id: 'bad-stones', position: north.position, tiles: north.tiles, fightState: 'stone' }],
  };
  assert.throws(() => assertValidDungeonDefinition(overlap), /condividono la tile|sovrappongono/);

  assert.equal(dungeonFlames(RUINS_DUNGEON).length, 1);
  assert.equal(dungeonStoneTiles(RUINS_DUNGEON).length, 4);
});
