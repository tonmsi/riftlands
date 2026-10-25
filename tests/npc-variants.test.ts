import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR_CATALOG, parseActorCatalog } from '../shared/actor-catalog';
import { duplicateNpcVariant, npcDisplayName, npcVariant } from '../shared/npc-variants';
import { NPC_DEFINITIONS } from '../shared/npcs';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { validNpcSettings } from '../shared/npc-settings';
import { World } from '../shared/world';
import { WorldSimulation } from '../server/simulation';
import { CatalogSpriteRenderer } from '../client/render/catalog-sprite-renderer';
import { projectActor } from '../shared/snapshot-actor';

test('duplicated NPCs own their skin and keep the original behavior, including copies of copies', () => {
  const catalog = structuredClone(ACTOR_CATALOG), original = structuredClone(catalog);
  const copy = duplicateNpcVariant(catalog, 'old-fisher', 'inn-keeper'); copy.name = 'Locandiere'; copy.group = 'Abitanti';
  catalog.skins[copy.skin].drawSize = 80;
  catalog.skins[copy.skin].animations.moving.asset = '/actor-assets/inn.png';
  const second = duplicateNpcVariant(catalog, copy, 'inn-assistant');
  assert.equal(second.base, 'old-fisher'); assert.equal(second.group, 'Abitanti');
  assert.notEqual(second.skin, copy.skin); assert.equal(catalog.skins[second.skin].drawSize, 80);
  catalog.skins[second.skin].animations.moving.columns = 8;
  assert.notEqual(catalog.skins[second.skin].animations.moving.columns, catalog.skins[copy.skin].animations.moving.columns);
  assert.deepEqual(catalog.skins[original.npcSkins!['old-fisher']!], original.skins[original.npcSkins!['old-fisher']!]);
  assert.deepEqual(catalog.bosses, original.bosses);
  assert.doesNotThrow(() => parseActorCatalog(catalog));
  assert.equal(npcDisplayName('old-fisher', { variantId: copy.id }, catalog), 'Locandiere');
  assert.equal(npcDisplayName('old-fisher', { variantId: copy.id, name: 'Marco' }, catalog), 'Marco');
  assert.equal(npcVariant(catalog, 'slime', copy.id), undefined);
  assert.throws(() => duplicateNpcVariant(catalog, copy, copy.id), /già usato/);
  assert.throws(() => duplicateNpcVariant(catalog, copy, 'old-fisher'), /già usato/);
  assert.throws(() => duplicateNpcVariant(catalog, copy, '../bad'), /non valido/);
});

test('catalog and world parsing preserve variant identity and reject malformed references', () => {
  const catalog = structuredClone(ACTOR_CATALOG), copy = duplicateNpcVariant(catalog, 'slime', 'red-slime');
  const doc = newWorldDocument(); doc.npcs.push({ id: 'one', npcKind: 'slime', x: 2, y: 2, level: 2, settings: { variantId: copy.id } });
  assert.equal(parseWorldDocument(JSON.stringify(doc)).npcs[0].settings?.variantId, copy.id);
  assert.deepEqual(parseActorCatalog(JSON.parse(JSON.stringify(catalog))).npcVariants, [copy]);
  assert.equal(validNpcSettings({ variantId: '../bad' }), false);
  for (const patch of [{ id: 'slime' }, { base: 'missing' }, { skin: 'missing' }, { name: ' ' }, { skin: 'stone-warden' }, { group: 42 }]) {
    assert.throws(() => parseActorCatalog({ ...catalog, npcVariants: [{ ...copy, ...patch }] }), /variante NPC/);
  }
  assert.throws(() => parseActorCatalog({ ...catalog, npcVariants: [copy, copy] }), /variante NPC/);
});

test('server keeps base AI and dialogue while replicating independent visuals and names', t => {
  const previousVariants = ACTOR_CATALOG.npcVariants;
  const copy = duplicateNpcVariant(ACTOR_CATALOG, 'dock-skeptic', 'test-citizen'); copy.name = 'Cittadino';
  t.after(() => { ACTOR_CATALOG.npcVariants = previousVariants; delete ACTOR_CATALOG.skins[copy.skin]; });
  const doc = newWorldDocument();
  for (let y = -10; y < 12; y++) for (let x = -10; x < 12; x++) doc.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  doc.npcs = [
    { id: 'variant', npcKind: 'dock-skeptic', level: 1, x: 2, y: 2, settings: { variantId: copy.id } },
    { id: 'original', npcKind: 'dock-skeptic', level: 1, x: 3, y: 2 },
  ];
  const world = new World(doc.seed, 16, 'world', doc, []);
  const simulation = new WorldSimulation(doc.seed, 1000, undefined, 'world', { world, spawn: { x: 24, y: 24 }, dungeons: [], bosses: new Map() });
  simulation.addPlayer({ id: 'test', name: 'Test', nameLower: 'test', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 }, 'warrior');
  simulation.step(.05);
  const actor = simulation.npcs.get('authored:variant')!, original = simulation.npcs.get('authored:original')!;
  assert.equal(actor.name, 'Cittadino'); assert.equal(actor.npcKind, original.npcKind);
  assert.equal(actor.speed, original.speed); assert.equal(actor.disposition, original.disposition); assert.equal(actor.dialogueId, original.dialogueId);
  assert.equal(original.name, NPC_DEFINITIONS['dock-skeptic'].name); assert.equal(original.npcVariantId, undefined);
  assert.equal(projectActor(actor).npcVariantId, copy.id);
  const renderer = new CatalogSpriteRenderer();
  assert.equal(renderer.visual(projectActor(actor)), ACTOR_CATALOG.skins[copy.skin]);
  assert.notEqual(renderer.visual(original), renderer.visual(actor));
});
