import test from 'node:test';
import assert from 'node:assert/strict';
import { authoredRockStairGeometry, authoredStairWallOpening, rockStairGeometry, rockWallOpenings, stairEndpointMouth } from '../client/render/rock-cliff-geometry';
import { stairGeometry } from '../shared/surface-stairs';
import { ELEVATION_STEP, type SurfaceCell, type SurfaceLink, type SurfaceStair } from '../shared/world-surfaces';

const cell = (x: number, y: number, elevation = 0, wallMaterial: SurfaceCell['wallMaterial'] = 'rock'): SurfaceCell =>
  ({ x, y, elevation, surfaceId: 'ground', kind: 'ground', material: 'grass', wallMaterial });

test('rock stairs preserve cardinal treads and end levels for every direction and allowed rise', () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const rise of [1, 2, 3, 6, 16]) {
    const low = cell(-2, 4), high = cell(-2 + dx, 4 + dy, rise), stairs = rockStairGeometry(low, high)!;
    assert.equal(stairs.dx, dx); assert.equal(stairs.dy, dy);
    assert.ok(stairs.treads.length >= 3 && stairs.treads.length <= 64);
    assert.equal(stairs.width, 48);
    const first = stairs.treads[0].riser;
    assert.equal((first[0].x + first[1].x) / 2, (-2 + .5) * 48);
    assert.equal((first[0].y + first[1].y) / 2, (4 + .5) * 48);
    const last = stairs.treads.at(-1)!.top;
    assert.equal((last[2].x + last[3].x) / 2, (high.x + .5) * 48);
    assert.equal((last[2].y + last[3].y) / 2, (high.y + .5) * 48 - rise * ELEVATION_STEP);
    for (const step of stairs.treads) for (const p of [...step.top, ...step.riser]) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    if (dx) assert.equal(first[0].x, first[1].x, 'sideways riser stays vertical rather than following a rotated ribbon');
    else assert.equal(first[0].y, first[1].y, 'frontal riser stays horizontal');
    assert.equal(stairs.sideFace.length > 0, dx !== 0, 'sideways stairs have a continuous stone support beneath their treads');
    assert.ok(stairs.corridor.length >= 8);
  }
});

test('click direction does not change rock stair geometry, and existing non-rock links keep their renderer', () => {
  const low = cell(2, 3), high = cell(3, 3, 2);
  assert.deepEqual(rockStairGeometry(low, high), rockStairGeometry(high, low));
  assert.equal(rockStairGeometry(low, cell(3, 3, 2, 'brick')), undefined);
  assert.equal(rockStairGeometry(low, cell(3, 3)), undefined);
  assert.equal(rockStairGeometry(low, cell(3, 4, 2)), undefined);
  const flat = rockStairGeometry(low, high, false)!;
  assert.equal(flat.treads.at(-1)!.top[2].y, flat.treads[0].riser[1].y);
});

test('stair openings cut only the rock face at a real frontal high endpoint, independently of link order', () => {
  const high = cell(4, 4, 3), low = cell(4, 5);
  const cells = [high, low, cell(3, 4), cell(4, 3)];
  const lookup = (p: SurfaceLink['from']) => cells.find(c => c.x === p.x && c.y === p.y && c.surfaceId === p.surfaceId);
  const end = (c: SurfaceCell) => ({ x: c.x, y: c.y, surfaceId: c.surfaceId });
  const stairs: SurfaceLink = { id: 'stairs', kind: 'stairs', from: end(low), to: end(high) };
  assert.deepEqual(rockWallOpenings(high, [stairs], lookup), [{ x: 0, width: 48 }]);
  assert.deepEqual(rockWallOpenings(high, [{ ...stairs, from: end(high), to: end(low) }], lookup), [{ x: 0, width: 48 }]);
  assert.deepEqual(rockWallOpenings(high, [{ ...stairs, kind: 'bridge-entry' }], lookup), []);
  assert.deepEqual(rockWallOpenings({ ...high, wallMaterial: 'brick' }, [stairs], lookup), []);
  assert.deepEqual(rockWallOpenings(high, [{ ...stairs, from: end(cells[2]) }], lookup), []);
  assert.deepEqual(rockWallOpenings(low, [stairs], lookup), []);
});

test('authored stairs assemble continuous cardinal slabs on one profile, including both landings', () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const rise of [1, 3, 6, 16]) for (const width of [40, 48, 96, 144]) {
    // Keep a positive projected central run for south-facing steps, including high rises.
    const length = dy > 0 ? Math.max(3, Math.ceil(rise * 16 / 48) + 2) : rise === 1 ? 1 : 3;
    const stair: SurfaceStair = { id: 'test', kind: 'stairs', from: { x: -2, y: 4, elevation: 0, surfaceId: 'ground' },
      to: { x: -2 + dx * length, y: 4 + dy * length, elevation: rise, surfaceId: 'ground' }, width };
    const logical = stairGeometry(stair), art = authoredRockStairGeometry(stair), count = art.treads.length;
    assert.equal(art.width, width);
    assert.deepEqual(art, authoredRockStairGeometry({ ...stair, from: stair.to, to: stair.from }));
    for (const [i, step] of art.treads.entries()) {
      const t = logical.landing / logical.run + (1 - 2 * logical.landing / logical.run) * (i + 1) / count;
      const world = logical.pointAt(t);
      assert.ok(Math.abs((step.top[2].x + step.top[3].x) / 2 - world.x) < 1e-7);
      assert.ok(Math.abs((step.top[2].y + step.top[3].y) / 2 - (world.y - logical.elevationAt(t) * 16)) < 1e-7);
      assert.ok(Math.abs(Math.hypot(step.top[0].x - step.top[1].x, step.top[0].y - step.top[1].y) - width) < 1e-7);
      if (i) {
        const previous = art.treads[i - 1];
        assert.ok(Math.hypot(previous.top[2].x - step.riser[1].x, previous.top[2].y - step.riser[1].y) < 1e-7, 'no gap between a tread and the following riser');
        assert.ok(Math.hypot(previous.top[3].x - step.riser[0].x, previous.top[3].y - step.riser[0].y) < 1e-7);
        if (dx) assert.ok((step.center.x - previous.center.x) * dx > 0);
        else assert.ok((step.center.y - previous.center.y) * dy > 0, 'valid stairs keep their projected treads in order');
      }
    }
    const first = art.lowerLanding, last = art.landing;
    assert.equal((first[0].x + first[1].x) / 2, (stair.from.x + .5) * 48);
    assert.equal((first[0].y + first[1].y) / 2, (stair.from.y + .5) * 48);
    assert.equal((last[2].x + last[3].x) / 2, (stair.to.x + .5) * 48);
    assert.equal((last[2].y + last[3].y) / 2, (stair.to.y + .5) * 48 - rise * 16);
  }
});

test('a two-cell side stair rises 1:1 between its flat landings at three levels', () => {
  const stair: SurfaceStair = { id: 'side', kind: 'stairs', from: { x: 0, y: 0, elevation: 0, surfaceId: 'ground' },
    to: { x: 2, y: 0, elevation: 3, surfaceId: 'ground' }, width: 48 };
  const g = stairGeometry(stair);
  assert.equal(g.run - g.landing * 2, g.rise);
  const art = authoredRockStairGeometry(stair);
  assert.equal(art.lowerLanding[2].x - art.lowerLanding[0].x, 24);
  assert.equal(art.landing[2].x - art.landing[0].x, 24);
  assert.equal(art.treads[0].top[2].x - art.treads[0].top[0].x, 4);
});

test('an explicit suspended stair omits the solid body while preserving steps and both landings', () => {
  const stair: SurfaceStair = { id: 'body', kind: 'stairs', from: { x: 4, y: 4, elevation: 0, surfaceId: 'ground' },
    to: { x: 8, y: 4, elevation: 3, surfaceId: 'ground' }, width: 48 };
  for (const projected of [true, false]) {
    const solid = authoredRockStairGeometry(stair, projected);
    assert.ok(solid.sideFace.length > 0);
    assert.deepEqual(authoredRockStairGeometry({ ...stair, underpass: false }, projected), solid);
    const suspended = authoredRockStairGeometry({ ...stair, underpass: true }, projected);
    assert.deepEqual(suspended, { ...solid, sideFace: [] }, 'only the supporting stone triangle changes');
  }
});

test('the full useful stair width opens each high bank lane and only its actual entry face', () => {
  const stair: SurfaceStair = { id: 'wide', kind: 'stairs', from: { x: 4, y: 8, elevation: 0, surfaceId: 'ground' },
    to: { x: 4, y: 4, elevation: 6, surfaceId: 'ground' }, width: 96 };
  const low = cell(4, 8), high = cell(4, 4, 6);
  assert.deepEqual(authoredStairWallOpening(stair, high), { x: 0, width: 48 });
  assert.deepEqual(authoredStairWallOpening(stair, cell(3, 4, 6)), { x: 24, width: 24 });
  assert.deepEqual(authoredStairWallOpening(stair, cell(5, 4, 6)), { x: 0, width: 24 });
  assert.equal(authoredStairWallOpening(stair, low), undefined);
  assert.ok(stairEndpointMouth(low, high, low, stair.width), 'the low landing also keeps grass out of its approach');
  for (const unrelated of [cell(2, 4, 6), cell(4, 3, 6), { ...high, surfaceId: 'bridge' }]) {
    assert.equal(authoredStairWallOpening(stair, unrelated), undefined);
    assert.equal(stairEndpointMouth(low, high, unrelated, stair.width), undefined);
  }
  assert.ok(stairEndpointMouth(low, high, cell(3, 4, 6), stair.width));
  assert.equal(authoredStairWallOpening({ ...stair, from: { ...stair.from, x: 0, y: 4 } }, high), undefined, 'side entry must not cut a south wall');
  const projected = stairEndpointMouth(low, high, high, 48)!, flat = stairEndpointMouth(low, high, high, 48, false)!;
  assert.deepEqual(projected, flat.map(p => ({ ...p, y: p.y - 6 * 16 })));
});
