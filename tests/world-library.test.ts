import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importWorldImage, readWorldProject, saveWorldProject } from '../scripts/world-library';
import { newWorldDocument } from '../shared/world-schema';
import { acquireDataLease } from '../server/data-lease';
import { engineBundle } from './fixtures/dungeon-engine';
import { worldDungeons } from '../shared/world-validation';

test('image import is immutable, content addressed, and accepts local gradients while rejecting active or external SVG content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'riftlands-world-images-'));
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="g"><stop stop-color="#fff"/></linearGradient></defs><rect width="48" height="48" fill="url(\'#g\')"/></svg>';
    const encoded = Buffer.from(svg).toString('base64');
    const path = await importWorldImage(root, 'image/svg+xml', encoded);
    assert.equal(await importWorldImage(root, 'image/svg+xml', encoded), path);
    assert.equal(await readFile(join(root, 'public', path), 'utf8'), svg);
    for (const bad of ['<svg onload="alert(1)"/>', '<svg><script/></svg>', '<svg><image href="https://example.com/a.png"/></svg>', '<svg><foreignObject/></svg>', '<!DOCTYPE svg><svg/>', '<svg><style>x{fill:url(https://example.com/a)}</style></svg>', '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>']) {
      await assert.rejects(importWorldImage(root, 'image/svg+xml', Buffer.from(bad).toString('base64')), /SVG/);
    }
    await assert.rejects(importWorldImage(root, 'image/png', encoded), /PNG/);
    assert.equal((await readdir(join(root, 'public/world-assets'))).length, 1);
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
