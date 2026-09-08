import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer } from '../client/snapshots';
import type { Actor, Projectile, Snapshot } from '../shared/types';

function actor(id: string, x: number): Actor {
  return {
    id, x, y: 0, kind: 'player', name: id, classId: 'mage', radius: 15,
    hp: 110, maxHp: 110, resource: 120, maxResource: 120, aim: 0, speed: 190,
    level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0,
    deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 },
  };
}
function snapshot(time: number, x = time * 0.2): Snapshot {
  return {
    type: 'snapshot', tick: Math.round(time * 0.03), time, ack: 0,
    self: actor('self', 0), actors: [actor('remote', x)],
    projectiles: [], pickups: [], events: [], online: 2, activeChunks: 1,
  };
}
function projectile(x: number): Projectile {
  return { id: 'shot', ownerId: 'remote', x, y: 0, vx: 200, vy: 0, radius: 6, damage: 10, expiresAt: 5000, color: '#fff' };
}

test('10 Hz snapshots remain continuous at 60 Hz with 100 ms one-way delay and jitter', () => {
  const buffer = new SnapshotBuffer();
  const packets = Array.from({ length: 100 }, (_, i) => {
    const time = 1000 + i * 100;
    return { data: snapshot(time), received: i * 100 + 100 + [0, 18, -12, 36, -8, 5][i % 6] };
  });
  let next = 0;
  const positions: number[] = [], times: number[] = [];
  for (let now = 0; now < 9700; now += 1000 / 60) {
    while (next < packets.length && packets[next].received <= now) {
      buffer.push(packets[next].data, packets[next].received); next++;
    }
    const result = buffer.sample(now);
    if (result && now > 1000) { positions.push(result.actors[0].x); times.push(result.time); }
  }
  for (let i = 1; i < positions.length; i++) {
    const moved = positions[i] - positions[i - 1];
    assert.ok(moved > 2.9 && moved < 3.7, `Unexpected movement per frame: ${moved}`);
    assert.ok(times[i] > times[i - 1], 'Playback must not rewind when packets arrive');
  }
});

test('starvation holds the last state without extrapolation, then recovers without rewinding', () => {
  const buffer = new SnapshotBuffer();
  for (let i = 0; i < 30; i++) {
    buffer.push(snapshot(1000 + i * 100), i * 100);
    for (let frame = 0; frame < 6; frame++) buffer.sample(i * 100 + frame * 1000 / 60);
  }
  const lastX = snapshot(3900).actors[0].x;
  let previous = 0;
  for (let now = 3000; now < 3500; now += 1000 / 60) {
    const result = buffer.sample(now)!;
    assert.ok(result.actors[0].x >= previous);
    assert.ok(result.actors[0].x <= lastX, 'A stalled connection must never predict through walls');
    previous = result.actors[0].x;
  }
  assert.equal(previous, lastX);
  buffer.push(snapshot(4500), 3500);
  assert.ok(buffer.sample(3517)!.actors[0].x >= previous);
});

test('oldest underflow and newest overflow select the appropriate endpoints', () => {
  const buffer = new SnapshotBuffer();
  buffer.push(snapshot(1000), 0);
  assert.equal(buffer.sample(0)!.actors[0].x, 200);
  for (let i = 1; i <= 20; i++) buffer.push(snapshot(1000 + i * 100), i * 100);
  assert.equal(buffer.sample(5000)!.actors[0].x, 600);
  assert.equal(buffer.sample(5050)!.actors[0].x, 600);
});

test('latest visibility removes hidden and departed actors immediately; death and teleport never lerp', () => {
  const buffer = new SnapshotBuffer();
  buffer.push(snapshot(1000, 0), 0);
  const hidden = snapshot(1100, 20); hidden.actors = [];
  buffer.push(hidden, 100);
  assert.deepEqual(buffer.sample(110)!.actors, []);

  buffer.clear(); buffer.push(snapshot(1000, 0), 0);
  const dead = snapshot(1100, 20); dead.actors[0].hp = 0;
  buffer.push(dead, 100);
  assert.equal(buffer.sample(200)!.actors[0].hp, 0);
  assert.equal(buffer.sample(200)!.actors[0].x, 20);

  buffer.clear(); buffer.push(snapshot(1000, 0), 0);
  buffer.push(snapshot(1100, 1000), 100);
  assert.equal(buffer.sample(200)!.actors[0].x, 1000);
});

test('projectiles share the actor timeline, never appear before observation, and vanish on impact', () => {
  const buffer = new SnapshotBuffer();
  const first = snapshot(1000, 0), second = snapshot(1100, 20);
  first.projectiles = [projectile(0)]; second.projectiles = [projectile(20)];
  buffer.push(first, 0); buffer.push(second, 100);
  const result = buffer.sample(200)!;
  assert.equal(result.actors[0].x, result.projectiles[0].x);
  buffer.push(snapshot(1200, 40), 200);
  assert.deepEqual(buffer.sample(210)!.projectiles, []);

  buffer.clear(); first.projectiles = [];
  buffer.push(first, 0); buffer.push(second, 100);
  assert.deepEqual(buffer.sample(200)!.projectiles, []);
  assert.equal(buffer.sample(260)!.projectiles[0].x, 20);
});

test('clear, long gaps and identity changes reset history; duplicate snapshots do not rewind playback', () => {
  const buffer = new SnapshotBuffer();
  assert.equal(buffer.sample(0), null);
  buffer.push(snapshot(1000, 0), 0); buffer.push(snapshot(1100, 20), 100);
  const before = buffer.sample(200)!;
  buffer.push(snapshot(1100, 999), 210);
  assert.ok(buffer.sample(220)!.time > before.time);
  assert.ok(buffer.sample(220)!.actors[0].x <= 20);
  buffer.push(snapshot(5000, 800), 4000);
  assert.equal(buffer.sample(4000)!.actors[0].x, 800);
  const nextIdentity = snapshot(5100, 2000); nextIdentity.self.id = 'other';
  buffer.push(nextIdentity, 4100);
  assert.equal(buffer.sample(4100)!.actors[0].x, 2000);
  buffer.clear(); assert.equal(buffer.sample(4200), null);
  buffer.push(snapshot(500, 15), 4300);
  assert.equal(buffer.sample(4300)!.actors[0].x, 15);
});
