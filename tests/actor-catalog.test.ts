import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ACTOR_CATALOG, parseActorCatalog } from '../shared/actor-catalog';
import { packDungeonCatalog, unpackDungeonCatalog, unpackDraftTiles, serializeDungeonCatalog } from '../shared/dungeon-storage';
import { engineBundle } from './fixtures/dungeon-engine';
import { compactDungeonFile } from '../scripts/compact-dungeons';
import { readCatalog } from '../scripts/dungeon-removal';
import { compactDungeonDraft, parseDungeonDraft } from '../shared/dungeon-draft';
import { saveActorProject, readActorProject } from '../scripts/actor-library';
import { animationFrame, bossAnimation } from '../client/render/actor-animation';
import { buildDungeonBundle } from '../shared/dungeon-install';
import { newWorldDocument } from '../shared/world-schema';
import { World } from '../shared/world';
import { WorldSimulation } from '../server/simulation';

test('explicit instance overrides survive updates while unmodified properties follow the catalog', () => {
  const bundle = engineBundle(); bundle.bosses[0].hp = 123; bundle.bosses[0].radius = 30;
  const packed = packDungeonCatalog([bundle]), next = structuredClone(ACTOR_CATALOG); next.bosses[0].hp = 999; next.bosses[0].speed = 125;
  const updated = unpackDungeonCatalog(packed, next)[0].bosses[0];
  assert.equal(updated.hp, 123); assert.equal(updated.radius, 30); assert.equal(updated.speed, 125);
  const draft = structuredClone(bundle.draft!); draft.entities.find(e => e.kind === 'boss')!.inheritRadius = true;
  next.bosses[0].radius = 32;
  assert.equal(buildDungeonBundle(draft, [], { templates: new Map(next.bosses.map(b => [b.id, b])) }).bosses[0].radius, 32);
});

test('bounded codecs and visual definitions reject invalid data before saving', () => {
  assert.throws(() => unpackDraftTiles([['path', 999999]], 100));
  assert.throws(() => unpackDraftTiles([['unknown', 1]], 1));
  const packed = packDungeonCatalog([engineBundle()]) as any[];
  packed[0].definition.layout.tileRuns[0][2] = 99999; assert.throws(() => unpackDungeonCatalog(packed));
  const catalog = structuredClone(ACTOR_CATALOG); catalog.skins['stone-warden'].animations.idle.asset = '/../../private.png'; assert.throws(() => parseActorCatalog(catalog));
  const next = structuredClone(ACTOR_CATALOG); next.skins['stone-warden'].anchor.y = 1.1; assert.throws(() => parseActorCatalog(next));
});

test('offline migration is lossless, much smaller, backed up and idempotent', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'riftlands-compact-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'custom-dungeons.json'), bundle = engineBundle(), text = JSON.stringify([bundle], null, 2);
  await writeFile(path, text);
  const result = await compactDungeonFile(path); assert.ok(result.after < result.before * .5); assert.equal(await readFile(result.backup!, 'utf8'), text);
  const read = await readCatalog(path); assert.deepEqual(read.bundles[0].definition, bundle.definition);
  assert.equal((await compactDungeonFile(path)).backup, undefined);
});

test('catalog saves validate assets/references, reject stale revisions and preserve dungeon bytes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'riftlands-actors-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const options = { root: process.cwd(), documentPath: join(dir, 'world.json'), dungeonPath: join(dir, 'dungeons.json'), dataPath: join(dir, 'accounts.json') };
  const path = join(dir, 'actor-catalog.json'); await writeFile(path, JSON.stringify(ACTOR_CATALOG));
  const dungeonText = serializeDungeonCatalog([engineBundle()]); await writeFile(options.dungeonPath, dungeonText);
  const project = await readActorProject(path), next = structuredClone(project.catalog); next.bosses[0].hp += 20; next.skins['stone-warden'].anchor.y = .7;
  const saved = await saveActorProject(options, next, project.revision); assert.equal(saved.catalog.bosses[0].hp, next.bosses[0].hp);
  assert.equal(await readFile(options.dungeonPath, 'utf8'), dungeonText);
  await assert.rejects(saveActorProject(options, next, project.revision), /altra finestra/);
  next.bosses = next.bosses.filter(b => b.id !== 'stone-warden'); await assert.rejects(saveActorProject(options, next, saved.revision), /Template boss assente/);
});

test('animation frames support arbitrary sheets, directions, loops and terminal death frame', () => {
  const a = { asset: '/actor-assets/test.png', columns: 6, rows: 4, directional: true, loop: true, frameMs: 100 };
  assert.equal(animationFrame(a, { name: 'walk', elapsed: 700 }, 2), 13);
  const death = { ...a, columns: 5, rows: 2, directional: false, loop: false, durationMs: 1000 };
  assert.equal(animationFrame(death, { name: 'death', elapsed: Infinity }, 0), 9);
  assert.equal(animationFrame(death, { name: 'death', elapsed: 300 }, 0), 3);
});
