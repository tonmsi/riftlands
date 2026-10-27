import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR_CATALOG, parseActorCatalog } from '../shared/actor-catalog';
import { animationFrame, resolveAnimation, bossAnimation } from '../client/render/actor-animation';
import type { Actor } from '../shared/types';

test('bosses support idle-only, moving-only and legacy walk sheets without altering attack timing', () => {
  const catalog = structuredClone(ACTOR_CATALOG), v = catalog.skins[catalog.bosses[0].skin];
  const movement = v.animations.walk ?? v.animations.moving;
  for (const key of ['walk', 'moving']) {
    v.animations = { [key]: movement };
    assert.doesNotThrow(() => parseActorCatalog(catalog));
    for (let row = 0; row < 4; row++) {
      const idle = resolveAnimation(v, { name: 'idle', elapsed: 2000 })!;
      assert.equal(animationFrame(idle.animation, idle.state, row), row * movement.columns);
      const walk = resolveAnimation(v, { name: 'moving', elapsed: 130 })!;
      assert.equal(walk.animation, movement); assert.notEqual(walk.state.frozen, true);
    }
  }
  v.animations = { idle: movement };
  assert.doesNotThrow(() => parseActorCatalog(catalog));
  const idleOnly = resolveAnimation(v, { name: 'moving', elapsed: 130 })!;
  assert.equal(idleOnly.animation, movement); assert.notEqual(idleOnly.state.frozen, true);
  const actor = { hp: 100, bossAwakenedAt: 0, bossMeleeAt: 2000 } as Actor;
  assert.deepEqual(bossAnimation(actor, 2200, false), { name: 'melee', elapsed: 200 });
  assert.equal(bossAnimation(actor, 3000, true).name, 'moving');
});

test('boss attack names are optional, persist and reject invalid values', () => {
  const catalog = structuredClone(ACTOR_CATALOG), attack = catalog.bosses[0].attacks[0];
  attack.name = 'Fendente del custode';
  assert.equal(parseActorCatalog(catalog).bosses[0].attacks[0].name, attack.name);
  for (const name of ['', '  ', 'a'.repeat(81), 42]) {
    (attack as any).name = name; assert.throws(() => parseActorCatalog(catalog));
  }
  delete attack.name; assert.doesNotThrow(() => parseActorCatalog(catalog));
});
