import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR_CATALOG, parseActorCatalog } from '../shared/actor-catalog';
import { animationFrame, resolveAnimation } from '../client/render/actor-animation';

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
  catalog.npcSkins!['old-fisher'] = 'stone-warden'; assert.throws(() => parseActorCatalog(catalog));
  catalog.npcSkins = { unknown: 'npc-old-fisher' } as any; assert.throws(() => parseActorCatalog(catalog));
  catalog.npcSkins = { 'old-fisher': 'npc-old-fisher' };
  delete catalog.skins['stone-warden'].animations.idle;
  assert.throws(() => parseActorCatalog(catalog));
});
