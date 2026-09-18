import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldSimulation } from '../server/simulation';
import type { Account } from '../server/store';
import { predictMovement } from '../client/prediction';

const account = (id: string): Account => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });

test('owner prediction and observer snapshots share analog and keyboard facing, including idle pushes', () => {
  const sim = new WorldSimulation(734291, 1_000_000);
  const owner = sim.addPlayer(account('owner'), 'mage');
  const observer = sim.addPlayer(account('observer'), 'mage');
  Object.assign(owner, { x: 0, y: 0 });
  Object.assign(observer, { x: 70, y: 0 });
  const inputs = [
    { dx: 0.12, dy: -0.9, analogMovement: true, row: 1 },
    { dx: -0.15, dy: 0.8, analogMovement: true, row: 0 },
    { dx: 1, dy: -1, analogMovement: false, row: 3 },
    { dx: 0, dy: 0, analogMovement: false, row: 3 },
  ];
  for (const [index, sample] of inputs.entries()) {
    const input = { ...sample, seq: index + 1, aim: 0 };
    const predicted = predictMovement(owner, input, sim.world, sim.now);
    assert.equal(sim.enqueueInput(owner.id, input), true);
    sim.step();
    const remote = sim.snapshotFor(observer.id)!.actors.find(actor => actor.id === owner.id)!;
    assert.equal(predicted.spriteRow, sample.row);
    assert.equal(remote.spriteRow, predicted.spriteRow);
    assert.equal(remote.spriteMoving, predicted.spriteMoving);
  }
  Object.assign(observer, { x: owner.x, y: owner.y });
  sim.step();
  assert.equal(owner.spriteRow, 3, 'collision displacement never changes input facing');
  assert.equal(owner.spriteMoving, false);
  assert.equal(sim.enqueueInput(owner.id, { seq: 5, dx: 0, dy: 0, aim: 0, analogMovement: 'yes' as unknown as boolean }), false);
});
