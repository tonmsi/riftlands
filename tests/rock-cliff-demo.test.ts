import test from 'node:test';
import assert from 'node:assert/strict';
import { newRockCliffDemoWorld, newRockCliffDemoDungeon } from '../shared/rock-cliff-demo';
import { World } from '../shared/world';
import { validateWorld } from '../shared/world-validation';
import { validateDungeonDraft, compileDungeonDraft } from '../shared/dungeon-draft';
import { moveWithCollisions } from '../shared/physics';
import { visualElevationAt } from '../shared/surface-presentation';

test('rock cliff samples validate, remain independent and include traversable stairs in four directions', () => {
  const document = newRockCliffDemoWorld(), world = new World(document.seed, 16, 'world', document, []);
  assert.deepEqual(validateWorld(document, []), []);
  const draft = newRockCliffDemoDungeon();
  assert.deepEqual(validateDungeonDraft(draft, []), []); assert.ok(compileDungeonDraft(draft, []));
  const directions = new Set<string>();
  for (const link of document.surfaceLinks!) {
    const from = { x: (link.from.x + .5) * 48, y: (link.from.y + .5) * 48, surfaceId: link.from.surfaceId };
    Object.assign(from, world.surfaceState(from));
    const dx = link.to.x - link.from.x, dy = link.to.y - link.from.y;
    directions.add(`${dx},${dy}`);
    let point = { ...from, radius: 12 };
    for (let i = 0; i < 24; i++) Object.assign(point, moveWithCollisions(point, dx, dy, 2, world));
    assert.equal(Math.floor(point.x / 48), link.to.x); assert.equal(Math.floor(point.y / 48), link.to.y);
    assert.equal(world.elevationAt(point), world.surfaceAt(link.to.x, link.to.y)!.elevation);
    const middle = { x: from.x + dx * 24, y: from.y + dy * 24, ...world.surfaceState(from) };
    const low = Math.min(world.elevationAt(from), world.surfaceAt(link.to.x, link.to.y)!.elevation), high = Math.max(world.elevationAt(from), world.surfaceAt(link.to.x, link.to.y)!.elevation);
    assert.ok(visualElevationAt(middle, world) > low && visualElevationAt(middle, world) < high);
  }
  assert.ok(['1,0', '-1,0', '0,-1', '0,1'].every(direction => directions.has(direction)));
  draft.surfaceCells![0].elevation = 15;
  assert.equal(newRockCliffDemoDungeon().surfaceCells![0].elevation, 2);
});
