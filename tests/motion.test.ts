import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../shared/config';
import type { Actor } from '../shared/types';
import { LocalMovementView, contactPresentation } from '../client/motion';

for (const boss of [false, true]) test(`contact presentation uses authoritative relative positions against ${boss ? 'bosses' : 'players'}`, () => {
  const local = { ...actor(50), y: 12 }, authoritative = actor(0);
  const other: Actor = { ...actor(boss ? 60 : 30), id: 'other', radius: boss ? 45 : 15,
    kind: boss ? 'npc' : 'player', ...(boss ? { npcKind: 'boss' as const } : {}) };
  const saved = structuredClone(other);
  const shown = contactPresentation(local, authoritative, [authoritative, other]);
  assert.equal(shown.x, authoritative.x);
  assert.equal(shown.y, authoritative.y);
  assert.equal(other.x - shown.x, other.x - authoritative.x, 'prediction cannot put the other actor on the wrong side');
  assert.deepEqual(other, saved);
  assert.equal(local.x, 50, 'input prediction is untouched');
});

test('contact presentation restores free movement and ignores corpses, respawns and other identities', () => {
  const local = actor(50), authoritative = actor();
  assert.equal(contactPresentation(local, authoritative, [actor(50)]).x, 50, 'self is not a collision partner');
  assert.equal(contactPresentation(local, authoritative, [{ ...actor(70), id: 'dead', hp: 0 }]).x, 50);
  assert.equal(contactPresentation(local, authoritative, [{ ...actor(400), id: 'far' }]).x, 50);
  assert.equal(contactPresentation(local, { ...authoritative, deadUntil: 20 }, [{ ...actor(30), id: 'near' }]), local);
  assert.equal(contactPresentation(local, { ...authoritative, id: 'old-session' }, []), local);
  const blended = contactPresentation(local, authoritative, [{ ...actor(140), id: 'near' }]);
  assert.ok(blended.x > authoritative.x && blended.x < local.x);
});

function actor(x = 0): Actor {
  return { id: 'self', x, y: 0, kind: 'player', name: 'Test', classId: 'mage', radius: 15, hp: 110, maxHp: 110, resource: 120, maxResource: 120, aim: 0, speed: 190, level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
}

for (const fps of [60, 144]) test(`30 Hz prediction produces continuous movement at ${fps} display frames per second`, () => {
  const view = new LocalMovementView();
  let current = actor(), accumulator = 0, lastX = 0;
  const delta = 1 / fps;
  view.reset(current);
  for (let frame = 0; frame < fps * 2; frame++) {
    accumulator += delta;
    while (accumulator + 1e-12 >= DT) {
      accumulator -= DT;
      const next = { ...current, x: current.x + current.speed * DT };
      view.advance(current, next); current = next;
    }
    const rendered = view.sample(current, accumulator / DT, delta);
    if (frame > 5) assert.ok(Math.abs(rendered.x - lastX - current.speed * delta) < 1e-7);
    lastX = rendered.x;
  }
});

test('reconciliation between ticks preserves displayed position and converges without editing physics state', () => {
  const view = new LocalMovementView(), before = actor(10), current = actor(16);
  view.reset(before); view.advance(before, current);
  const shown = view.sample(current, 0.4, 0);
  const corrected = { ...current, x: 13 };
  view.correct(current, corrected);
  assert.equal(view.sample(corrected, 0.4, 0).x, shown.x);
  assert.equal(current.x, 16); assert.equal(corrected.x, 13);
  view.advance(corrected, corrected);
  for (let frame = 0; frame < 60; frame++) view.sample(corrected, 1, 1 / 60);
  assert.ok(Math.abs(view.sample(corrected, 1, 0).x - corrected.x) < 0.001);
});

test('stop and direction changes stay within their collision-checked simulation endpoints', () => {
  const view = new LocalMovementView();
  view.reset(actor()); view.advance(actor(), actor(6));
  assert.equal(view.sample(actor(6), 0.5, 0).x, 3);
  view.advance(actor(6), actor(6));
  assert.equal(view.sample(actor(6), 0.7, 0).x, 6);
  view.advance(actor(6), actor());
  assert.equal(view.sample(actor(), 0.5, 0).x, 3);
});

test('death, respawn, large displacement and session resets never drag the old body across the map', () => {
  const view = new LocalMovementView();
  view.reset(actor()); view.advance(actor(), actor(6));
  view.correct(actor(6), actor(300));
  assert.equal(view.sample(actor(300), 0.5, 0).x, 300);
  const dead = { ...actor(310), hp: 0, deadUntil: 1000 };
  view.correct(actor(300), dead); assert.equal(view.sample(dead, 0, 0).x, 310);
  view.correct(dead, actor(60)); assert.equal(view.sample(actor(60), 0, 0).x, 60);
  view.reset(); view.correct(null, actor(-900)); assert.equal(view.sample(actor(-900), 0, 0).x, -900);
});
