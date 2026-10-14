import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build, createServer } from 'vite';
import { scanWallSpriteKits, wallSpriteKitPlugin } from '../scripts/wall-sprite-kits';
import { parseWallSpriteKitCatalog, type WallSpriteKitCatalog, type WallSpritePartImage } from '../shared/wall-sprite-kits';

// A real, lossless 1 × 1 PNG; scanner fixtures use the same files that Vite copies.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=', 'base64');
const TEMP_PARENT = path.resolve('artifacts');
async function withFixture(action: (root: string) => Promise<void>): Promise<void> {
  await mkdir(TEMP_PARENT, { recursive: true });
  const root = await mkdtemp(path.join(TEMP_PARENT, 'wall-sprite-tests-'));
  try { await action(root); }
  finally {
    const absolute = await realpath(root);
    assert.equal(path.dirname(absolute).toLowerCase(), (await realpath(TEMP_PARENT)).toLowerCase());
    assert.ok(path.basename(absolute).startsWith('wall-sprite-tests-'));
    await rm(absolute, { recursive: true, force: true });
  }
}
async function kit(root: string, id: string, settings?: unknown, parts: readonly string[] = ['body']): Promise<string> {
  const directory = path.join(root, id); await mkdir(directory, { recursive: true });
  if (settings !== undefined) await writeFile(path.join(directory, 'kit.json'), JSON.stringify(settings));
  for (const part of parts) await writeFile(path.join(directory, `${part}.png`), PNG);
  return directory;
}
function validCatalog(): WallSpriteKitCatalog {
  return { version: 1, issues: [], kits: [{ id: 'wall-roccia', name: 'Roccia', material: 'rock', tileSize: 16, levelHeight: 16 / 3,
    pixelated: true, parts: { body: { image: '/terrain-walls/wall-roccia/body.png', width: 16, height: 16 } } }] };
}
const GRID_PARTS = ['back-left', 'back', 'back-right', 'side-left', 'center', 'side-right', 'corner-left', 'front', 'corner-right'] as const;

test('a 3 × 3 cliff kit retains its layout and all nine named PNGs through discovery and client parsing', async () => withFixture(async root => {
  await kit(root, 'wall-grid', { name: 'Roccia a griglia', layout: 'grid-3x3', tileSize: 395,
    levelHeight: 395 / 3, pixelated: false }, GRID_PARTS);
  const catalog = await scanWallSpriteKits(root);
  assert.deepEqual(catalog.issues, []); assert.equal(catalog.kits.length, 1);
  const grid = catalog.kits[0];
  assert.equal(grid.layout, 'grid-3x3'); assert.equal(grid.tileSize, 395);
  assert.equal(grid.levelHeight, 395 / 3); assert.equal(grid.pixelated, false);
  for (const part of GRID_PARTS) assert.deepEqual(grid.parts[part],
    { image: `/terrain-walls/wall-grid/${part}.png`, width: 1, height: 1 });
  assert.deepEqual(grid.parts.body, grid.parts.front, 'front remains the mandatory face alias; center is a separate empty cell');
  assert.deepEqual(parseWallSpriteKitCatalog(catalog), catalog);
}));

test('unknown wall layouts cannot silently change a kit rendering contract', async () => withFixture(async root => {
  await kit(root, 'wall-good');
  for (const [index, layout] of ['grid', 'grid-4x4', '', null, 3].entries()) {
    await kit(root, `wall-layout-${index}`, { layout });
    const catalog: any = validCatalog(); catalog.kits[0].layout = layout;
    assert.throws(() => parseWallSpriteKitCatalog(catalog), /non valid/);
  }
  const discovered = await scanWallSpriteKits(root);
  assert.deepEqual(discovered.kits.map(grid => grid.id), ['wall-good']);
  for (let index = 0; index < 5; index++) assert.ok(discovered.issues.some(issue => issue.includes(`wall-layout-${index}`)));
}));

test('the imported cliff grid exposes all nine runtime pieces at the original third boundaries', async () => {
  const catalog = await scanWallSpriteKits(path.resolve('public/terrain-walls'));
  const grid = catalog.kits.find(candidate => candidate.id === 'wall-roccia-grid');
  assert.ok(grid, 'the imported grid must be available to the game and both editors');
  assert.equal(grid.layout, 'grid-3x3'); assert.equal(grid.tileSize, 395);
  assert.equal(grid.levelHeight, 395 / 3); assert.equal(grid.pixelated, false);
  const widths = [395, 396, 395], heights = [394, 395, 394];
  for (const [index, name] of GRID_PARTS.entries()) {
    const part: WallSpritePartImage | undefined = grid.parts[name]; assert.ok(part, `missing ${name}.png`);
    assert.equal(part.image, `/terrain-walls/wall-roccia-grid/${name}.png`);
    assert.equal(part.width, widths[index % 3]); assert.equal(part.height, heights[Math.floor(index / 3)]);
    assert.equal(part.flipX, undefined, 'directional tiles preserve their actual source orientation');
  }
  assert.deepEqual(parseWallSpriteKitCatalog({ version: 1, kits: [grid], issues: [] }).kits[0], grid);
});

test('wall PNG folders load defaults and metadata, require body and ignore unrelated names', async () => withFixture(async root => {
  await kit(root, 'wall-default');
  await kit(root, 'wall-custom', { name: '  Terra antica  ', material: 'earth', tileSize: 16, pixelated: false }, ['body', 'corner-left', 'stairs-tread']);
  await writeFile(path.join(root, 'wall-custom', 'unrelated.png'), PNG);
  await kit(root, 'wall-no-body', undefined, ['cap']);
  const catalog = await scanWallSpriteKits(root);
  assert.deepEqual(catalog.kits.map(k => k.id), ['wall-custom', 'wall-default']);
  assert.deepEqual(catalog.kits[1], { id: 'wall-default', name: 'wall default', material: 'rock', tileSize: 48, levelHeight: 16,
    pixelated: true, parts: { body: { image: '/terrain-walls/wall-default/body.png', width: 1, height: 1 } } });
  const custom = catalog.kits[0]; assert.equal(custom.name, 'Terra antica'); assert.equal(custom.material, 'earth');
  assert.equal(custom.tileSize, 16); assert.equal(custom.levelHeight, 16 / 3); assert.equal(custom.pixelated, false);
  assert.equal(custom.parts['corner-left']?.image, '/terrain-walls/wall-custom/corner-left.png');
  assert.equal(custom.parts['stairs-tread']?.width, 1);
  assert.ok(catalog.issues.some(issue => issue.includes('unrelated.png') && issue.includes('ignorato')));
  assert.ok(catalog.issues.some(issue => issue.includes('wall-no-body') && issue.includes('body.png')));
  assert.deepEqual(parseWallSpriteKitCatalog(catalog), catalog);
}));

test('a malformed folder, config or PNG never hides another valid wall kit', async () => withFixture(async root => {
  await kit(root, 'wall-good'); await kit(root, 'Uppercase');
  const badJson = await kit(root, 'wall-json'); await writeFile(path.join(badJson, 'kit.json'), '{');
  await kit(root, 'wall-array', []); await kit(root, 'wall-material', { material: 'lava' });
  const badPng = await kit(root, 'wall-png'); await writeFile(path.join(badPng, 'body.png'), 'not a png');
  const truncated = await kit(root, 'wall-truncated'); await writeFile(path.join(truncated, 'body.png'), PNG.subarray(0, 33));
  const badPart = await kit(root, 'wall-part'); await writeFile(path.join(badPart, 'cap.png'), 'not a png');
  const oversized = await kit(root, 'wall-json-size'); await writeFile(path.join(oversized, 'kit.json'), ' '.repeat(16_385));
  const hugePng = await kit(root, 'wall-png-size'), file = await open(path.join(hugePng, 'body.png'), 'r+');
  try { await file.truncate(16 * 1024 * 1024 + 1); } finally { await file.close(); }
  const dimension = await kit(root, 'wall-dimensions'); const tooWide = Buffer.from(PNG); tooWide.writeUInt32BE(8193, 16);
  await writeFile(path.join(dimension, 'body.png'), tooWide);
  const catalog = await scanWallSpriteKits(root);
  assert.deepEqual(catalog.kits.map(k => k.id), ['wall-good']);
  for (const name of ['Uppercase', 'wall-json', 'wall-array', 'wall-material', 'wall-png', 'wall-truncated', 'wall-part', 'wall-json-size', 'wall-png-size', 'wall-dimensions'])
    assert.ok(catalog.issues.some(issue => issue.includes(name)), `missing issue for ${name}`);
}));

test('complete front and generic corner PNGs provide named fallbacks and source artwork stays outside the catalog', async () => withFixture(async root => {
  const folder = await kit(root, 'wall-aliases', undefined, ['front', 'corner']);
  await writeFile(path.join(folder, 'cliff-front-source.png'), 'unprocessed source artwork');
  const catalog = await scanWallSpriteKits(root), parts = catalog.kits[0].parts;
  assert.deepEqual(catalog.issues, []);
  assert.equal(parts.front!.image, '/terrain-walls/wall-aliases/front.png');
  assert.deepEqual(parts.body, parts.front);
  assert.deepEqual(parts['corner-left'], parts.corner);
  assert.deepEqual(parts['corner-right'], { ...parts.corner, flipX: true });
  assert.deepEqual(parseWallSpriteKitCatalog(catalog), catalog, 'alias expansion is stable across rescans and client parsing');
}));

test('canonical body and directional corners take precedence while a complete front remains available', async () => withFixture(async root => {
  await kit(root, 'wall-named', undefined, ['body', 'front', 'corner', 'corner-left', 'corner-right']);
  const catalog = await scanWallSpriteKits(root), parts = catalog.kits[0].parts;
  assert.deepEqual(catalog.issues, []);
  assert.equal(parts.body!.image, '/terrain-walls/wall-named/body.png');
  assert.equal(parts.front!.image, '/terrain-walls/wall-named/front.png');
  assert.equal(parts['corner-left']!.image, '/terrain-walls/wall-named/corner-left.png');
  assert.equal(parts['corner-right']!.image, '/terrain-walls/wall-named/corner-right.png');
  assert.equal(parts['corner-right']!.flipX, undefined);
}));

test('aliases fall back independently and adding a canonical part replaces only that fallback', async () => withFixture(async root => {
  const folder = await kit(root, 'wall-partial', undefined, ['front', 'corner', 'corner-left']);
  const first = (await scanWallSpriteKits(root)).kits[0];
  assert.equal(first.parts.body!.image, '/terrain-walls/wall-partial/front.png');
  assert.equal(first.parts['corner-left']!.image, '/terrain-walls/wall-partial/corner-left.png');
  assert.equal(first.parts['corner-right']!.image, '/terrain-walls/wall-partial/corner.png');
  assert.equal(first.parts['corner-right']!.flipX, true);
  await writeFile(path.join(folder, 'body.png'), PNG);
  const next = (await scanWallSpriteKits(root)).kits[0];
  assert.equal(next.parts.body!.image, '/terrain-walls/wall-partial/body.png');
  assert.deepEqual(next.parts.front, first.parts.front); assert.deepEqual(next.parts['corner-right'], first.parts['corner-right']);
}));

test('the parser validates alias paths and reflection metadata without permitting arbitrary local PNGs', () => {
  const catalog = validCatalog();
  delete catalog.kits[0].parts.body;
  catalog.kits[0].parts.front = { image: '/terrain-walls/wall-roccia/front.png', width: 381, height: 409 };
  catalog.kits[0].parts.corner = { image: '/terrain-walls/wall-roccia/corner.png', width: 381, height: 409, flipX: true };
  const parsed = parseWallSpriteKitCatalog(catalog), parts = parsed.kits[0].parts;
  assert.deepEqual(parts.body, parts.front); assert.equal(parts['corner-left']!.flipX, true); assert.equal(parts['corner-right']!.flipX, false);
  assert.deepEqual(parseWallSpriteKitCatalog(parsed), parsed);
  for (const mutate of [
    (c: any) => { c.kits[0].parts.body.image = '/terrain-walls/wall-roccia/front-source.png'; },
    (c: any) => { c.kits[0].parts['corner-right'].image = '/terrain-walls/wall-roccia/front.png'; },
    (c: any) => { c.kits[0].parts['corner-left'].image = '/terrain-walls/another/corner.png'; },
    (c: any) => { c.kits[0].parts['corner-right'].flipX = 'true'; },
  ]) { const invalid = structuredClone(parsed); mutate(invalid); assert.throws(() => parseWallSpriteKitCatalog(invalid), /Componente/); }
});

test('the catalog parser permits only local named PNG parts and bounded metadata', () => {
  const catalog = validCatalog(); assert.deepEqual(parseWallSpriteKitCatalog(catalog), catalog);
  const largeSource = validCatalog(); largeSource.kits[0].tileSize = 8192; largeSource.kits[0].parts.body!.width = 8192;
  assert.equal(parseWallSpriteKitCatalog(largeSource).kits[0].tileSize, 8192);
  for (const mutate of [
    (c: any) => { c.kits[0].id = '../wall-roccia'; },
    (c: any) => { c.kits[0].parts.body.image = 'https://example.com/body.png'; },
    (c: any) => { c.kits[0].parts.body.image = '/terrain-walls/another/body.png'; },
    (c: any) => { c.kits[0].parts.body.image = '/terrain-walls/wall-roccia/body.png?x=1'; },
    (c: any) => { c.kits[0].parts.body.image = '/terrain-walls/wall-roccia/../body.png'; },
    (c: any) => { c.kits[0].parts.unknown = c.kits[0].parts.body; },
    (c: any) => { delete c.kits[0].parts.body; },
    (c: any) => { c.kits[0].parts.body.width = 0; },
    (c: any) => { c.kits[0].parts.body.height = 8193; },
    (c: any) => { c.kits[0].parts.body.width = 1.5; },
    (c: any) => { c.kits[0].tileSize = 8193; },
    (c: any) => { c.kits[0].levelHeight = .1; },
    (c: any) => { c.kits[0].pixelated = 'true'; },
    (c: any) => { c.kits[0].name = ''; },
    (c: any) => { c.kits.push(c.kits[0]); },
    (c: any) => { c.issues = ['x'.repeat(513)]; },
    (c: any) => { c.issues = Array(513).fill('bad'); },
    (c: any) => { c.kits = Array(129).fill(c.kits[0]); },
  ]) { const invalid = validCatalog(); mutate(invalid); assert.throws(() => parseWallSpriteKitCatalog(invalid), /non valid|manca/); }
});

test('rescanning discovers added kits and parts and an absent library stays empty', async () => withFixture(async root => {
  assert.deepEqual(await scanWallSpriteKits(path.join(root, 'missing')), { version: 1, kits: [], issues: [] });
  await kit(root, 'wall-first'); assert.equal((await scanWallSpriteKits(root)).kits.length, 1);
  await kit(root, 'wall-second', { levelHeight: 7.5 }); await writeFile(path.join(root, 'wall-first', 'foot.png'), PNG);
  const catalog = await scanWallSpriteKits(root);
  assert.equal(catalog.kits.length, 2); assert.ok(catalog.kits[0].parts.foot); assert.equal(catalog.kits[1].levelHeight, 7.5);
}));

test('wall discovery skips linked directories and, when supported, linked PNG files', async t => withFixture(async root => {
  await kit(root, 'wall-source');
  try { await symlink(path.join(root, 'wall-source'), path.join(root, 'wall-linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error: any) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error; t.diagnostic('Linked directory fixture unavailable on this host.'); return; }
  assert.deepEqual((await scanWallSpriteKits(root)).kits.map(k => k.id), ['wall-source']);
  const linkedFile = path.join(root, 'wall-file'); await mkdir(linkedFile);
  try { await symlink(path.join(root, 'wall-source', 'body.png'), path.join(linkedFile, 'body.png'), 'file'); }
  catch (error: any) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error; t.diagnostic('Linked PNG fixture unavailable on this host.'); return; }
  const catalog = await scanWallSpriteKits(root);
  assert.deepEqual(catalog.kits.map(k => k.id), ['wall-source']);
  assert.ok(catalog.issues.some(issue => issue.includes('wall-file') && issue.includes('body.png')));
}));

test('Vite refreshes its catalog on request and emits the same catalog with original PNG files in a build', { timeout: 30_000 }, async () => withFixture(async root => {
  const publicDir = path.join(root, 'public'), walls = path.join(publicDir, 'terrain-walls');
  await kit(walls, 'wall-first'); await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Wall fixtures</title>');
  const server = await createServer({ configFile: false, root, publicDir, plugins: [wallSpriteKitPlugin()], logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
  try {
    await server.listen(); const url = `${server.resolvedUrls!.local[0]}terrain-walls/catalog.json`;
    const first = await fetch(url); assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.equal((await first.json() as WallSpriteKitCatalog).kits.length, 1);
    await kit(walls, 'wall-second');
    assert.equal((await (await fetch(`${url}?refresh=1`)).json() as WallSpriteKitCatalog).kits.length, 2);
    const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
    const post = await fetch(url, { method: 'POST' }); assert.equal(post.status, 405); assert.equal(post.headers.get('allow'), 'GET, HEAD');
  } finally { await server.close(); }
  const outDir = path.join(root, 'dist');
  await build({ configFile: false, root, publicDir, plugins: [wallSpriteKitPlugin()], logLevel: 'silent', build: { outDir } });
  const emitted = parseWallSpriteKitCatalog(JSON.parse(await readFile(path.join(outDir, 'terrain-walls', 'catalog.json'), 'utf8')));
  assert.deepEqual(emitted, await scanWallSpriteKits(walls));
  assert.deepEqual(await readFile(path.join(outDir, 'terrain-walls', 'wall-first', 'body.png')), PNG);
}));
