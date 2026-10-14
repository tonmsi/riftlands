import test from 'node:test';
import assert from 'node:assert/strict';
import { DT, TILE_SIZE } from '../shared/config';
import type { Actor, InputCommand, Vec2 } from '../shared/types';
import type { Account } from '../server/store';
import { WorldSimulation } from '../server/simulation';
import { World } from '../shared/world';
import { newTerrainReferenceDemoWorld } from '../shared/terrain-reference-demo';
import { newSurfaceDemoWorld } from '../shared/surface-demo';
import { visualElevationAt } from '../shared/surface-presentation';
import { predictMovement, reconcile } from '../client/core/prediction';

const center = (x: number, y: number): Vec2 => ({ x: (x + .5) * TILE_SIZE, y: (y + .5) * TILE_SIZE, surfaceId: 'ground' });
const routes = [
  { name: 'short north-facing staircase', document: newTerrainReferenceDemoWorld, low: center(7, 14), high: center(7, 13), height: 3, dx: 0, dy: -1 },
  { name: 'two-cell lateral staircase', document: newTerrainReferenceDemoWorld, low: center(4, 10), high: center(6, 10), height: 3, dx: 1, dy: 0 },
  { name: 'legacy adjacent stair link', document: newSurfaceDemoWorld, low: center(3, 7), high: center(4, 7), height: 2, dx: 1, dy: 0 },
];

function fixture(route: typeof routes[number], descending = false) {
  const document = route.document(), world = new World(document.seed, 16, 'world', document, []);
  // Keep the authoritative test isolated from procedural actors, pickups and pushes.
  world.getChunk = (cx, cy) => ({ cx, cy, key: `${cx},${cy}`, tiles: [], npcs: [], pickups: [] });
  const start = descending ? route.high : route.low;
  const sim = new WorldSimulation(document.seed, 1_000_000, undefined, 'world', { world, dungeons: [], bosses: new Map(), spawn: start });
  const account: Account = { id: 'walking-sync', name: 'Walking sync', nameLower: 'walking sync', salt: '', passwordHash: '',
    xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 };
  const player = sim.addPlayer(account, 'warrior');
  Object.assign(player, start, world.surfaceState(start), { speed: 190 });
  return { sim, player, world };
}

function assertSamePosition(actual: Actor, expected: Actor, context: string): void {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `${context}: x ${actual.x} !== ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `${context}: y ${actual.y} !== ${expected.y}`);
  assert.equal(actual.surfaceId, expected.surfaceId, `${context}: support`);
  assert.equal(actual.elevation, expected.elevation, `${context}: elevation`);
}

for (const route of routes) for (const descending of [false, true]) {
  test(`server and prediction remain identical while ${descending ? 'descending' : 'ascending'} a ${route.name}`, () => {
    for (const analog of [false, true]) {
      const { sim, player, world } = fixture(route, descending);
      if (analog) player.effects = [{ kind: 'haste', until: sim.now + 500 }, { kind: 'slow', until: sim.now + 1400 }];
      let predicted = structuredClone(player), sawSlope = false, reachedLanding = false;
      const amount = (descending ? -1 : 1) * (analog ? .45 : 1);
      for (let tick = 1; tick <= 90; tick++) {
        const input: InputCommand = { seq: tick, dx: route.dx * amount, dy: route.dy * amount,
          aim: Math.atan2(route.dy * amount, route.dx * amount), analogMovement: analog };
        assert.equal(sim.enqueueInput(player.id, input), true);
        predicted = predictMovement(predicted, input, world, sim.now + DT * 1000);
        sim.step();
        assertSamePosition(player, predicted, `tick ${tick}, analog=${analog}`);
        const elevation = visualElevationAt(player, world);
        sawSlope ||= elevation > .01 && elevation < route.height - .01;
        reachedLanding ||= player.surfaceId === 'ground' && player.elevation === (descending ? 0 : route.height);
      }
      assert.equal(sawSlope, true, 'the test must exercise the inclined part of the staircase');
      assert.equal(reachedLanding, true, 'the actor must leave the flight onto the opposite landing');
    }
  });
}

test('reconciliation replays pending stair movement with the same fixed-step profile and effect times', () => {
  const { sim, player, world } = fixture(routes[0]);
  player.effects = [{ kind: 'haste', until: sim.now + 130 }, { kind: 'slow', until: sim.now + 390 }];
  const acknowledged = 8;
  const pending: InputCommand[] = Array.from({ length: 28 }, (_, i) => ({ seq: i + 1, dx: 0, dy: -.7, aim: -Math.PI / 2, analogMovement: true }));
  for (const input of pending.slice(0, acknowledged)) {
    assert.equal(sim.enqueueInput(player.id, input), true);
    sim.step();
  }
  const authoritative = structuredClone(player), time = sim.now;
  const remaining = pending.slice(acknowledged);
  let manuallyPredicted = structuredClone(authoritative);
  for (let i = 0; i < remaining.length; i++) manuallyPredicted = predictMovement(manuallyPredicted, remaining[i], world, time + (i + 1) * DT * 1000);
  const result = reconcile(authoritative, acknowledged, pending, world, time);
  assert.deepEqual(result.pending, remaining);
  assertSamePosition(result.actor, manuallyPredicted, 'pending replay');
  for (const input of remaining) {
    assert.equal(sim.enqueueInput(player.id, input), true);
    sim.step();
  }
  assertSamePosition(result.actor, player, 'authoritative continuation');
  assert.ok(visualElevationAt(result.actor, world) > 0, 'pending input actually advances onto the slope');
});
