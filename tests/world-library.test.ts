import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importWorldImage, readWorldProject, saveWorldProject } from '../scripts/world-library';
import { newWorldDocument, newWorldAsset } from '../shared/world-schema';
import { acquireDataLease } from '../server/data-lease';
import { engineBundle } from './fixtures/dungeon-engine';
import { worldDungeons } from '../shared/world-validation';
import { compactWorldFile } from '../scripts/compact-world';
import { ACTOR_CATALOG } from '../shared/actor-catalog';

test('permanent asset deletion saves the world and removes only an unshared image', async () => {
  const root = await mkdtemp(join(tmpdir(), 'riftlands-delete-asset-'));
  const options = { root, documentPath: join(root, 'world.json'), dungeonPath: join(root, 'dungeons.json'), dataPath: join(root, 'accounts.json') };
  try {
    const image = await importWorldImage(root, 'image/svg+xml', Buffer.from('<svg/>').toString('base64'), 'world-assets', 'delete.svg');
    const document = newWorldDocument();
    document.assets.push(newWorldAsset('delete', 'Delete', image));
    document.placements.push({ id: 'instance', assetId: 'delete', x: 10, y: 10 });
    await writeFile(options.documentPath, JSON.stringify(document)); await writeFile(options.dungeonPath, '[]');
    const current = await readWorldProject(options.documentPath);
    const shared = structuredClone(document); shared.assets.push(newWorldAsset('keep', 'Keep', image));
    await assert.rejects(saveWorldProject(options, shared, current.revision, 'delete'), /asset “Keep” \(keep\)/);
    assert.equal(await readFile(join(root, 'public', image.slice(1)), 'utf8'), '<svg/>');
    assert.equal((await readWorldProject(options.documentPath)).revision, current.revision);
    await assert.rejects(saveWorldProject(options, document, 'stale', 'delete'), /altra.*finestra/);
    await assert.rejects(saveWorldProject(options, document, current.revision, 'missing'), /non più presente/);
    const actors = structuredClone(ACTOR_CATALOG);
    Object.values(actors.skins)[0].animations.idle.asset = image;
    await writeFile(join(root, 'actor-catalog.json'), JSON.stringify(actors));
    await assert.rejects(saveWorldProject(options, document, current.revision, 'delete'), /aspetto personaggio/);
    await rm(join(root, 'actor-catalog.json'));
    const result = await saveWorldProject(options, document, current.revision, 'delete');
    const saved = await readWorldProject(options.documentPath);
    assert.equal(saved.revision, result.revision); assert.equal(saved.document.assets.length, 0); assert.equal(saved.document.placements.length, 0);
    await assert.rejects(readFile(join(root, 'public', image.slice(1))), { code: 'ENOENT' });
    assert.equal(JSON.parse(await readFile(result.backup, 'utf8')).assets[0].id, 'delete');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('image import preserves readable names, prevents overwrites, and rejects active or external SVG content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'riftlands-world-images-'));
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="g"><stop stop-color="#fff"/></linearGradient></defs><rect width="48" height="48" fill="url(\'#g\')"/></svg>';
    const encoded = Buffer.from(svg).toString('base64');
    const path = await importWorldImage(root, 'image/svg+xml', encoded, 'world-assets', 'Cespuglio estivo.svg');
    assert.equal(path, '/world-assets/Cespuglio-estivo.svg');
    assert.equal(await importWorldImage(root, 'image/svg+xml', encoded, 'world-assets', 'Cespuglio estivo.svg'), path);
    const different = Buffer.from('<svg/>').toString('base64');
    const alternate = await importWorldImage(root, 'image/svg+xml', different, 'world-assets', 'Cespuglio estivo.svg');
    assert.match(alternate, /^\/world-assets\/Cespuglio-estivo-[a-f0-9]{16}\.svg$/);
    assert.notEqual(alternate, path);
    assert.equal(await importWorldImage(root, 'image/svg+xml', different, 'world-assets', 'Cespuglio estivo.svg'), alternate);
    assert.equal((await readFile(join(root, 'public', path.slice(1)))).toString('base64'), encoded);
    assert.equal((await readFile(join(root, 'public', alternate.slice(1)))).toString('base64'), different);
    await assert.rejects(importWorldImage(root, 'image/svg+xml', encoded, 'world-assets', '../escape.svg'), /Nome file/);
    assert.equal(await readFile(join(root, 'public', path), 'utf8'), svg);
    for (const bad of ['<svg onload="alert(1)"/>', '<svg><script/></svg>', '<svg><image href="https://example.com/a.png"/></svg>', '<svg><foreignObject/></svg>', '<!DOCTYPE svg><svg/>', '<svg><style>x{fill:url(https://example.com/a)}</style></svg>', '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>']) {
      await assert.rejects(importWorldImage(root, 'image/svg+xml', Buffer.from(bad).toString('base64')), /SVG/);
    }
    await assert.rejects(importWorldImage(root, 'image/png', encoded), /PNG/);
    assert.equal((await readdir(join(root, 'public/world-assets'))).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('world writes validate before mutation, reject stale revisions and live leases, and back up the previous project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'riftlands-world-save-'));
  const options = { root, documentPath: join(root, 'world.json'), dungeonPath: join(root, 'dungeons.json'), dataPath: join(root, 'accounts.json') };
  const d = newWorldDocument();
  for (let y = -2; y < 3; y++) for (let x = -2; x < 3; x++) d.tiles.push({ x, y, terrain: 'grass' });
  try {
    await writeFile(options.documentPath, JSON.stringify(d)); await writeFile(options.dungeonPath, '[]'); await writeFile(options.dataPath, '{"version":3,"accounts":[{"id":"keep","gold":500}]}');
    const current = await readWorldProject(options.documentPath), next = structuredClone(d); next.seed++;
    const release = acquireDataLease(options.dataPath);
    try { await assert.rejects(saveWorldProject(options, next, current.revision), /Salvataggio in uso/); } finally { release(); }
    const result = await saveWorldProject(options, next, current.revision);
    assert.deepEqual(JSON.parse(await readFile(result.backup, 'utf8')), d); assert.equal((await readWorldProject(options.documentPath)).document.seed, next.seed);
    await assert.rejects(saveWorldProject(options, d, current.revision), /altra finestra|altra.*finestra/);
    const invalid = structuredClone(next); invalid.tiles.find(t => t.x === 0 && t.y === 0)!.terrain = 'rock';
    await assert.rejects(saveWorldProject(options, invalid, result.revision), /Spawn.*bloccato/);
    assert.equal(await readFile(options.dataPath, 'utf8'), '{"version":3,"accounts":[{"id":"keep","gold":500}]}');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('moving a dungeon clears only its saved boss states and retains all unrelated states and accounts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'riftlands-world-relocation-'));
  const options = { root, documentPath: join(root, 'world.json'), dungeonPath: join(root, 'catalog.json'), dataPath: join(root, 'accounts.json') };
  const bundle = engineBundle(), d = newWorldDocument();
  for (let y = -2; y < 3; y++) for (let x = -2; x < 3; x++) d.tiles.push({ x, y, terrain: 'grass' });
  try {
    await writeFile(options.documentPath, JSON.stringify(d)); await writeFile(options.dungeonPath, JSON.stringify([bundle]));
    await writeFile(options.dataPath, '{"version":3,"accounts":[{"id":"keep","gold":500}]}');
    const states = { version: 1, bosses: { [bundle.definition.bossId]: { respawnAt: 9, corpse: bundle.definition.spawnPoints.boss, drops: [] }, untouched: { marker: true } } };
    await writeFile(join(root, 'dungeon.json'), JSON.stringify(states));
    const current = await readWorldProject(options.documentPath); d.dungeons.push({ dungeonId: bundle.definition.id, x: -256, y: 512 });
    const result = await saveWorldProject(options, d, current.revision);
    assert.equal(result.backups.length, 2); assert.deepEqual(JSON.parse(await readFile(join(root, 'dungeon.json'), 'utf8')).bosses, { untouched: { marker: true } });
    assert.equal(await readFile(options.dataPath, 'utf8'), '{"version":3,"accounts":[{"id":"keep","gold":500}]}');
    const persisted = JSON.parse(await readFile(join(root, 'dungeon.json'), 'utf8'));
    persisted.bosses[bundle.definition.bossId] = { respawnAt: 10 };
    await writeFile(join(root, 'dungeon.json'), JSON.stringify(persisted));
    d.dungeons[0].enabled = false;
    await saveWorldProject(options, d, result.revision);
    assert.deepEqual(worldDungeons(d, [bundle.definition]), []);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'dungeon.json'), 'utf8')).bosses, { untouched: { marker: true } });
    d.dungeons[0].enabled = true;
    assert.equal(worldDungeons(d, [bundle.definition])[0].bossId, bundle.definition.bossId);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('format-only migration preserves every cell and accepts the old revision only until a semantic edit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'riftlands-world-format-'));
  const options = { root, documentPath: join(root, 'world.json'), dungeonPath: join(root, 'catalog.json'), dataPath: join(root, 'accounts.json') };
  const document = newWorldDocument();
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  try {
    await writeFile(options.documentPath, JSON.stringify(document)); await writeFile(options.dungeonPath, '[]');
    const old = await readWorldProject(options.documentPath), result = await compactWorldFile(options.documentPath), migrated = await readWorldProject(options.documentPath);
    assert.ok(result.after < result.before); assert.equal(result.cells, 49); assert.equal(migrated.document.tiles.length, 0);
    assert.deepEqual(migrated.compatibleRevisions, [old.revision]);
    const next = structuredClone(migrated.document); next.seed++;
    await saveWorldProject(options, next, old.revision);
    assert.deepEqual((await readWorldProject(options.documentPath)).compatibleRevisions, []);
    await assert.rejects(saveWorldProject(options, next, old.revision), /altra.*finestra/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
