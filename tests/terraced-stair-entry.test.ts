import test from 'node:test';
import assert from 'node:assert/strict';
import { newTerracedTerrainDemoWorld, TERRACED_DEMO_CARDINAL_FLIGHTS } from '../shared/terraced-terrain-demo';
import { World } from '../shared/world';
import { moveWalkingWithCollisions, moveWithCollisions } from '../shared/physics';
import { terracedStairEntryDirection } from '../shared/stair-entry';
import { planStair, stairGeometry, stairSurfaceId } from '../shared/surface-stairs';
import type { SurfaceEndpoint } from '../shared/world-surfaces';
import type { InputCommand, Vec2 } from '../shared/types';
import { DT } from '../shared/config';
import type { Account } from '../server/store';
import { WorldSimulation } from '../server/simulation';
import { predictMovement } from '../client/core/prediction';

const center = (p: SurfaceEndpoint) => ({ x: (p.x + .5) * 48, y: (p.y + .5) * 48, surfaceId: p.surfaceId });
const fixture = () => {
  const doc = newTerracedTerrainDemoWorld();
  return { doc, world: new World(doc.seed, 16, 'world', doc, []) };
};
const approach = (from: SurfaceEndpoint, dx: number, dy: number, offset: number) => ({
  ...center(from), x: center(from).x - dy * offset, y: center(from).y + dx * offset, radius: 15,
});

test('walking aligns both approaches to inset stairs in every direction without widening their corridor', () => {
  const { doc, world } = fixture();
  for (const flight of TERRACED_DEMO_CARDINAL_FLIGHTS) {
    const dx = Math.sign(flight.to.x - flight.from.x), dy = Math.sign(flight.to.y - flight.from.y);
    for (const sign of [1, -1]) for (const offset of [-31, -20, -12, 12, 20, 31]) {
      const bank = sign === 1 ? flight.from : flight.to, actor = approach(bank, dx, dy, offset);
      const moved = moveWalkingWithCollisions(actor, dx * sign, dy * sign, 300, world);
      assert.equal(moved.elevation, sign === 1 ? 3 : 0, `${flight.id}, ${offset}, ${sign}`);
      assert.equal(moved.surfaceId, 'ground');
      assert.ok((moved.x - actor.x) * dx * sign + (moved.y - actor.y) * dy * sign >= 192);
      const lateral = (moved.x - center(bank).x) * -dy + (moved.y - center(bank).y) * dx;
      assert.ok(Math.abs(lateral) <= 8, 'the actor lines up before entering the physical flight');
    }
  }
  assert.ok(doc.surfaceStairs!.every(stair => stair.width === 48));
});

test('entry guidance only responds to walking into a nearby landing with explicit sideways control cancelling it', () => {
  const { doc, world } = fixture(), stair = doc.surfaceStairs![0], g = stairGeometry(stair);
  const actor = approach(stair.from, 1, 0, 20);
  for (const direction of [{ x: 0, y: 1 }, { x: 1 / Math.SQRT2, y: 1 / Math.SQRT2 }, { x: -1, y: 0 }])
    assert.deepEqual(terracedStairEntryDirection(actor, direction, 5, world), direction);
  const direction = { x: 1, y: 0 };
  for (const point of [
    { ...actor, x: actor.x - 25 },
    { ...actor, y: center(stair.from).y + 39 },
    { ...actor, y: center(stair.from).y - 39 },
    { ...actor, y: center(stair.from).y + 8 },
    { ...g.pointAt(.5), radius: 15, surfaceId: stairSurfaceId(stair) },
  ]) assert.deepEqual(terracedStairEntryDirection(point, direction, 5, world), direction);
});

test('two adjacent stair mouths guide the player toward the nearest flight in both directions', () => {
  const { doc, world } = fixture(), flight = TERRACED_DEMO_CARDINAL_FLIGHTS[0];
  const from = { ...flight.from, y: flight.from.y + 1 }, to = { ...flight.to, y: flight.to.y + 1 };
  const plan = planStair(from, to, (x, y, id) => world.surfaceAt(x, y, id), {
    id: 'adjacent-west', profile: 'terraced', width: 48, cells: doc.surfaceCells, links: doc.surfaceLinks, stairs: doc.surfaceStairs,
  });
  doc.surfaceCells!.push(...plan.cells); doc.surfaceLinks!.push(...plan.links); doc.surfaceStairs!.push(plan.stair);
  const adjacent = new World(doc.seed, 16, 'world', doc, []);
  for (const sign of [1, -1]) {
    const actor = approach(sign === 1 ? flight.from : flight.to, 1, 0, 31), direction = { x: sign, y: 0 };
    assert.ok(terracedStairEntryDirection(actor, direction, 5, adjacent).y > 0, 'the closer lower mouth wins over insertion order');
    const moved = moveWalkingWithCollisions(actor, sign, 0, 300, adjacent);
    assert.equal(moved.elevation, sign === 1 ? 3 : 0);
    assert.ok(Math.abs(moved.y - center(from).y) <= 8);
    const linedUp = { ...actor, y: center(from).y + 4 };
    assert.deepEqual(terracedStairEntryDirection(linedUp, direction, 5, adjacent), direction, 'an already clear approach stays straight');
  }
});

test('entry assistance avoids surface resolution when no terraced staircase is nearby', () => {
  const { world } = fixture(), original = world.surfaceFor.bind(world);
  let queries = 0;
  world.surfaceFor = point => { queries++; return original(point); };
  const direction = { x: 1, y: 0 };
  assert.deepEqual(terracedStairEntryDirection({ x: 48, y: 48, surfaceId: 'ground', radius: 15 }, direction, 5, world), direction);
  assert.equal(queries, 0);
});

test('walking beside a stair remains blocked and guidance cannot cross an authored obstruction', () => {
  const { doc, world } = fixture();
  for (const flight of TERRACED_DEMO_CARDINAL_FLIGHTS) {
    const dx = Math.sign(flight.to.x - flight.from.x), dy = Math.sign(flight.to.y - flight.from.y);
    for (const sign of [1, -1]) for (const offset of [-40, 40]) {
      const actor = approach(sign === 1 ? flight.from : flight.to, dx, dy, offset);
      const moved = moveWalkingWithCollisions(actor, dx * sign, dy * sign, 300, world);
      assert.equal(moved.elevation, sign === 1 ? 0 : 3);
      assert.ok((moved.x - actor.x) * dx * sign + (moved.y - actor.y) * dy * sign < 24);
      assert.ok(Math.abs((moved.x - actor.x) * -dy + (moved.y - actor.y) * dx) < 1e-8);
    }
  }
  const flight = TERRACED_DEMO_CARDINAL_FLIGHTS[0];
  doc.surfaceCells!.find(cell => cell.surfaceId === 'stair:terraced-demo-west' && cell.x === 4 && cell.y === 13)!.blocked = true;
  const obstructed = new World(doc.seed, 16, 'world', doc, []), actor = approach(flight.from, 1, 0, 31);
  const stopped = moveWalkingWithCollisions(actor, 1, 0, 300, obstructed);
  assert.equal(stopped.elevation, 0);
  assert.ok(stopped.x <= 4 * 48 - actor.radius, 'alignment does not bypass the blocked support');
});

test('alignment spends walking time and leaves exact collision movement and historical stairs unchanged', () => {
  const { doc, world } = fixture(), flight = TERRACED_DEMO_CARDINAL_FLIGHTS[0];
  const actor = approach(flight.from, 1, 0, 31);
  let walked: Vec2 & { radius: number } = { ...actor }, travelled = 0;
  for (let i = 0; i < 80; i++) {
    const next = moveWalkingWithCollisions(walked, 1, 0, 5, world), stride = Math.hypot(next.x - walked.x, next.y - walked.y);
    assert.ok(stride <= 5 + 1e-8, 'a changed direction cannot increase the walking budget');
    travelled += stride; walked = { ...walked, ...next };
  }
  assert.ok(travelled <= 400 + 1e-8); assert.equal(walked.elevation, 3);
  const centered = moveWalkingWithCollisions({ ...center(flight.from), radius: 15 }, 1, 0, 400, world);
  assert.ok(walked.x < centered.x, 'lateral alignment costs forward progress');
  const pushed = moveWithCollisions(actor, 1, 0, 300, world);
  assert.equal(pushed.elevation, 0); assert.equal(pushed.y, actor.y);
  for (const stair of doc.surfaceStairs!) stair.profile = 'landings';
  const historical = new World(doc.seed, 16, 'world', doc, []), direction = { x: 1, y: 0 };
  assert.deepEqual(terracedStairEntryDirection(actor, direction, 5, historical), direction);
  const original = moveWithCollisions(actor, 1, 0, 5, historical), unchanged = moveWalkingWithCollisions(actor, 1, 0, 5, historical);
  assert.deepEqual(unchanged, original);
});

test('server simulation and client prediction apply identical entry alignment over ten ticks', () => {
  for (const flight of TERRACED_DEMO_CARDINAL_FLIGHTS) for (const sign of [1, -1]) for (const offset of [-31, 31]) {
    const { world } = fixture(), dx = Math.sign(flight.to.x - flight.from.x), dy = Math.sign(flight.to.y - flight.from.y);
    const start = approach(sign === 1 ? flight.from : flight.to, dx, dy, offset);
    world.getChunk = (cx, cy) => ({ cx, cy, key: `${cx},${cy}`, tiles: [], npcs: [], pickups: [] });
    const sim = new WorldSimulation(world.seed, 1_000_000, undefined, 'world', { world, dungeons: [], bosses: new Map(), spawn: start });
    const account: Account = { id: 'terraced-entry-sync', name: 'Entry sync', nameLower: 'entry sync', salt: '', passwordHash: '',
      xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 };
    const player = sim.addPlayer(account, 'warrior');
    Object.assign(player, start, world.surfaceState(start), { speed: 190 });
    let predicted = structuredClone(player);
    for (let tick = 1; tick <= 10; tick++) {
      const input: InputCommand = { seq: tick, dx: dx * sign, dy: dy * sign, aim: Math.atan2(dy * sign, dx * sign) };
      assert.equal(sim.enqueueInput(player.id, input), true);
      predicted = predictMovement(predicted, input, world, sim.now + DT * 1000); sim.step();
      assert.ok(Math.abs(player.x - predicted.x) < 1e-9); assert.ok(Math.abs(player.y - predicted.y) < 1e-9);
      assert.equal(player.surfaceId, predicted.surfaceId); assert.equal(player.elevation, predicted.elevation);
    }
    const shift = (player.x - start.x) * -dy + (player.y - start.y) * dx;
    assert.ok(Math.abs(shift) > 1, 'the synchronized ticks exercise lateral alignment');
    assert.equal(player.surfaceId, `stair:${flight.id}`, 'the synchronized ticks also enter the inclined part');
  }
});
