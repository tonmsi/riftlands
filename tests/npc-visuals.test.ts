import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR_CATALOG, parseActorCatalog } from '../shared/actor-catalog';
import { animationFrame, resolveAnimation } from '../client/render/actor-animation';
import { duplicateNpcVariant } from '../shared/npc-variants';

test('Rovan supports 4x4 movement at 130 ms; invalid fields identify the actor and precise cause', () => {
  const catalog = structuredClone(ACTOR_CATALOG);
  catalog.npcSkins!['north-scout'] = 'npc-north-scout';
  const v = catalog.skins['npc-north-scout'] = structuredClone(catalog.skins['npc-old-fisher']);
  v.animations.moving.asset = '/actor-assets/npc-explorer-rovan.png';
  assert.doesNotThrow(() => parseActorCatalog(catalog));
  v.animations.moving.durationMs = 0;
  assert.throws(() => parseActorCatalog(catalog), /Rovan.*moving.*Durata totale/);
  delete v.animations.moving.durationMs;
  v.animations.moving.rows = 1;
  assert.throws(() => parseActorCatalog(catalog), /Rovan.*moving.*richiede 4 righe/);
  v.animations.moving.rows = 4;
  v.animations.moving.asset = '/invalid/rovan.png';
  assert.throws(() => parseActorCatalog(catalog), /Rovan.*moving.*percorso spritesheet/);
});

test('missing NPC idle stays on the first moving frame for every facing direction', () => {
  const visual = ACTOR_CATALOG.skins['npc-old-fisher'];
  for (let row = 0; row < 4; row++) for (const elapsed of [0, 130, 2700]) {
    const resolved = resolveAnimation(visual, { name: 'idle', elapsed })!;
    assert.equal(resolved.state.frozen, true);
    assert.equal(animationFrame(resolved.animation, resolved.state, row), row * 4);
  }
  const moving = resolveAnimation(visual, { name: 'moving', elapsed: 130 })!;
  assert.equal(animationFrame(moving.animation, moving.state, 2), 9);
});

test('dedicated idle can animate independently and NPC catalog rejects broken assignments', () => {
  const catalog = structuredClone(ACTOR_CATALOG), visual = catalog.skins['npc-old-fisher'];
  visual.animations.idle = { ...visual.animations.moving, columns: 6, frameMs: 100 };
  const idle = resolveAnimation(visual, { name: 'idle', elapsed: 200 })!;
  assert.equal(animationFrame(idle.animation, idle.state, 1), 8);
  assert.doesNotThrow(() => parseActorCatalog(catalog));
  catalog.npcSkins!['old-fisher'] = 'missing'; assert.throws(() => parseActorCatalog(catalog));
  catalog.skins['invalid-npc'] = { ...structuredClone(visual), animations: {} };
  catalog.npcSkins!['old-fisher'] = 'invalid-npc'; assert.throws(() => parseActorCatalog(catalog));
  delete catalog.skins['invalid-npc'];
  catalog.npcSkins = { unknown: 'npc-old-fisher' } as any; assert.throws(() => parseActorCatalog(catalog));
  catalog.npcSkins = { 'old-fisher': 'npc-old-fisher' };
  delete catalog.skins['stone-warden'].animations.idle;
  delete catalog.skins['stone-warden'].animations.walk;
  delete catalog.skins['stone-warden'].animations.moving;
  assert.throws(() => parseActorCatalog(catalog));
});

test('NPCs and duplicated variants accept idle-only sheets and retain animation without moving', () => {
  const catalog = structuredClone(ACTOR_CATALOG), visual = catalog.skins['npc-old-fisher'];
  visual.animations = { idle: { ...visual.animations.moving, columns: 6, rows: 1, directional: false, loop: true, frameMs: 100 } };
  catalog.npcSkins!['old-fisher'] = 'npc-old-fisher';
  const copy = duplicateNpcVariant(catalog, 'old-fisher', 'idle-only-visual-test');
  assert.doesNotThrow(() => parseActorCatalog(catalog));
  assert.equal(catalog.skins[copy.skin].animations.moving, undefined);
  for (const name of ['idle', 'moving']) for (let row = 0; row < 4; row++) {
    const resolved = resolveAnimation(visual, { name, elapsed: 200 })!;
    assert.equal(resolved.animation, visual.animations.idle);
    assert.notEqual(resolved.state.frozen, true);
    assert.equal(animationFrame(resolved.animation, resolved.state, row), 2);
  }
  visual.animations.idle.directional = true; visual.animations.idle.rows = 4;
  for (let row = 0; row < 4; row++) {
    const resolved = resolveAnimation(visual, { name: 'moving', elapsed: 200 })!;
    assert.equal(animationFrame(resolved.animation, resolved.state, row), row * 6 + 2);
  }
  visual.animations = {};
  assert.throws(() => parseActorCatalog(catalog));
});
