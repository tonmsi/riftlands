import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorldDocument } from '../shared/world-schema';
import { World } from '../shared/world';
import { planStair } from '../shared/surface-stairs';
import { moveWithCollisions } from '../shared/physics';
import { TILE_SIZE } from '../shared/tile-size';

test('nested elevations keep flat shelves and successive inset stairs connect all three levels', () => {
  const document = newWorldDocument(); document.surfaceCells = []; document.surfaceLinks = []; document.surfaceStairs = [];
  for (let y = 0; y < 22; y++) for (let x = 0; x < 22; x++) {
    document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
    if (x < 2 || x > 18 || y < 2 || y > 18) continue;
    const elevation = x >= 10 && x <= 12 && y >= 10 && y <= 12 ? 3 : x >= 7 && x <= 14 && y >= 7 && y <= 14 ? 2 : 1;
    document.surfaceCells.push({ x, y, elevation, layout: 'terraced', surfaceId: 'ground', kind: 'ground', material: 'grass', wallMaterial: 'rock' });
  }
  let world = new World(document.seed, 16, 'world', document, []);
  for (const [low, high] of [[1, 3], [6, 8], [9, 11]]) {
    const plan = planStair({ x: low, y: 11, surfaceId: 'ground' }, { x: high, y: 11, surfaceId: 'ground' },
      (x, y, id) => world.surfaceAt(x, y, id), { id: `shelf-${high}`, profile: 'terraced', cells: document.surfaceCells,
        stairs: document.surfaceStairs, links: document.surfaceLinks });
    document.surfaceCells.push(...plan.cells); document.surfaceLinks.push(...plan.links); document.surfaceStairs.push(plan.stair);
    world = new World(document.seed, 16, 'world', document, []);
  }
  for (const [x, elevation] of [[2, 1], [7, 2], [10, 3]]) {
    assert.equal(world.surfaceAt(x, 11)!.terrainRole, 'wall');
    assert.equal(world.surfaceAt(x, 11)!.elevation, elevation);
  }
  for (const x of [3, 4, 5, 6, 8, 9, 11]) assert.equal(world.surfaceAt(x, 11)!.terrainRole, undefined);
  const origin = { x: 1.5 * TILE_SIZE, y: 11.5 * TILE_SIZE, radius: 15, surfaceId: 'ground', elevation: 0 };
  const climbed = moveWithCollisions(origin, 1, 0, 10 * TILE_SIZE, world);
  assert.ok(Math.abs(climbed.x - 11.5 * TILE_SIZE) < 1e-6); assert.equal(climbed.elevation, 3);
  const descended = moveWithCollisions({ ...climbed, radius: 15 }, -1, 0, 10 * TILE_SIZE, world);
  assert.ok(Math.abs(descended.x - origin.x) < 1e-6); assert.equal(descended.elevation, 0);
});
