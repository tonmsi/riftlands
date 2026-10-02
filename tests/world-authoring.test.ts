import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorldAsset, newWorldDocument, parseWorldDocument, resizeWorldAsset, worldAssetVisual, type WorldDocument } from '../shared/world-schema';
import { WorldAuthoring, type GenerationEnvironment } from '../shared/world-authoring';
import { World } from '../shared/world';
import { collidesWorld, hasLineOfSight } from '../shared/physics';
import { sweptWorldHit } from '../shared/projectiles';
import { WorldBrush, strokeTiles } from '../shared/world-editing';
import { relocateDungeon } from '../shared/dungeon-relocation';
import { assertValidDungeonDefinition } from '../shared/dungeons';
import { WorldSimulation } from '../server/simulation';
import { engineBundle } from './fixtures/dungeon-engine';
import { RoomManager } from '../server/rooms';

function grass(document: WorldDocument, x = -4, y = -4, width = 16, height = 16): void {
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) document.tiles.push({ x: x + dx, y: y + dy, terrain: 'grass' });
}
const environment: GenerationEnvironment = { tile: () => 'grass', temperature: () => .5, moisture: () => .5, reserved: () => false };

test('animated artwork survives serialization and legacy drafts while explicit imported images stay static', () => {
  const d = newWorldDocument(), a = newWorldAsset('renamed-fire', 'Fuoco', '/world-assets/brazier.svg');
  d.assets.push(a);
  assert.deepEqual(worldAssetVisual(parseWorldDocument(d).assets[0]), { kind: 'fire', style: 'brazier' });
  a.visual = { kind: 'image' };
  assert.deepEqual(worldAssetVisual(parseWorldDocument(d).assets[0]), { kind: 'image' });
  a.image = '/world-assets/imported.png'; a.visual = { kind: 'fire', style: 'campfire' };
  assert.deepEqual(worldAssetVisual(parseWorldDocument(JSON.stringify(d)).assets[0]), a.visual);
  (a.visual as any).style = 'unsupported';
  assert.throws(() => parseWorldDocument(d), /aspetto/);
});

test('world format rejects malformed masks, dangling references, duplicate cells and invalid NPC percentages', () => {
  const d = newWorldDocument(), a = newWorldAsset('tree', 'Albero', '/world-assets/tree.svg'); d.assets.push(a);
  assert.deepEqual(parseWorldDocument(d), d);
  a.cells = []; assert.throws(() => parseWorldDocument(d), /celle/); a.cells = [{ blocked: false, visibility: 'normal' }];
  d.placements.push({ id: 'missing', assetId: 'missing', x: 0, y: 0 }); assert.throws(() => parseWorldDocument(d), /riferimento/); d.placements = [];
  d.tiles.push({ x: -1, y: -1, terrain: 'grass' }, { x: -1, y: -1, suppressAssets: true }); assert.throws(() => parseWorldDocument(d), /duplicati/); d.tiles = [];
  d.zones.push({ id: 'zone', name: 'Zona', priority: 0, shape: { kind: 'rect', x: 0, y: 0, width: 10, height: 10 }, npcs: { density: 1, maxPerChunk: 3, weights: { slime: 40, wisp: 0, sentinel: 0 } } });
  assert.throws(() => parseWorldDocument(d), /percentuali/); d.zones[0].npcs!.weights.slime = 0; assert.doesNotThrow(() => parseWorldDocument(d));
  a.image = 'https://external.example/tree.svg'; assert.throws(() => parseWorldDocument(d), /asset/);
});

test('resize preserves coordinate-specific behavior while adding default cells and tracks fractional footprints', () => {
  const a = newWorldAsset('tree', 'Albero', '/world-assets/tree.svg'); resizeWorldAsset(a, 2, 2);
  a.cells[1] = { blocked: true, visibility: 'normal' }; a.cells[2] = { blocked: false, visibility: 'hide' };
  resizeWorldAsset(a, 3.25, 2.5);
  assert.equal(a.columns, 4); assert.equal(a.rows, 3); assert.equal(a.cells[1].blocked, true); assert.equal(a.cells[4].visibility, 'hide');
  assert.deepEqual(a.cells[11], { blocked: false, visibility: 'normal' }); assert.throws(() => resizeWorldAsset(a, Infinity, 1));
});

test('manual cells drive movement, line of sight, projectile sweeps and authoritative concealment', () => {
  const d = newWorldDocument(); grass(d);
  const a = newWorldAsset('tree', 'Albero', '/world-assets/tree.svg'); resizeWorldAsset(a, 3, 1);
  a.cells = [{ blocked: true, visibility: 'normal' }, { blocked: false, visibility: 'hide' }, { blocked: false, visibility: 'fade' }]; d.assets.push(a);
  d.placements.push({ id: 'tree-1', assetId: a.id, x: 1, y: 0 }); const world = new World(42, 16, 'world', d, []);
  assert.equal(collidesWorld(72, 24, 15, world), true); assert.equal(collidesWorld(120, 24, 15, world), false);
  assert.equal(hasLineOfSight({ x: 24, y: 24 }, { x: 120, y: 24 }, world), false);
  assert.ok(sweptWorldHit({ x: 24, y: 24 }, { x: 170, y: 24 }, 4, world)! < .5);
  const simulation = new WorldSimulation(42, 1_000_000, undefined, 'world', { world, dungeons: [], bosses: new Map(), spawn: { x: 0, y: 0 } });
  const player = simulation.addPlayer({ id: 'test', name: 'Test', nameLower: 'test', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 }, 'warrior');
  Object.assign(player, { x: 120, y: 24, spawnProtectedUntil: 0 }); simulation.step(); assert.equal(player.hidden, true);
  player.x = 168; simulation.step(); assert.equal(player.hidden, false); assert.equal(collidesWorld(player.x, player.y, player.radius, world), false);
});

test('procedural assets respect full footprints, climate and reservations with deterministic negative-coordinate seams', () => {
  const d = newWorldDocument(), a = newWorldAsset('tree', 'Albero', '/world-assets/tree.svg'); resizeWorldAsset(a, 3, 2);
  a.generation.enabled = true; a.generation.density = 1; a.generation.temperature = [.4, .6]; d.assets.push(a);
  const first = new WorldAuthoring(d), second = new WorldAuthoring(d), bounds = { left: -32, top: -16, right: 32, bottom: 16 };
  const result = first.assetsIn(bounds, environment, 42); assert.ok(result.length > 20);
  second.assetsIn({ left: 64, top: 64, right: 96, bottom: 96 }, environment, 42);
  assert.deepEqual(second.assetsIn(bounds, environment, 42), result);
  const left = first.assetsIn({ ...bounds, right: 0 }, environment, 42), right = first.assetsIn({ ...bounds, left: 0 }, environment, 42);
  assert.deepEqual(new Set([...left, ...right].map(p => p.id)), new Set(result.map(p => p.id)));
  const p = result[0], blocked = { x: p.x + 2, y: p.y + 1 };
  const denied = new WorldAuthoring(d).assetsIn(bounds, { ...environment, temperature: (x, y) => x === blocked.x && y === blocked.y ? .1 : .5 }, 42);
  assert.equal(denied.some(q => q.id === p.id), false);
  d.tiles.push({ x: blocked.x, y: blocked.y, suppressAssets: true });
  assert.equal(new WorldAuthoring(d).assetsIn(bounds, environment, 42).some(q => q.id === p.id), false);
  for (let x = 0; x < 3000; x++) first.assetsIn({ left: x * 16, top: 0, right: x * 16 + 1, bottom: 1 }, environment, 42);
  assert.ok(first.generationCacheSize <= 2048);
});

test('cross-chunk manual footprints suppress overlapping procedural assets and distant enormous zones stay queryable', () => {
  const d = newWorldDocument(), a = newWorldAsset('tree', 'Albero', '/world-assets/tree.svg'); resizeWorldAsset(a, 4, 3); d.assets.push(a);
  d.placements.push({ id: 'boundary', assetId: a.id, x: -1, y: 15 });
  d.zones.push({ id: 'continent', name: 'Continente', priority: 0, shape: { kind: 'rect', x: -100_000, y: -100_000, width: 200_000, height: 200_000 }, moisture: .8 });
  const index = new WorldAuthoring(d); assert.equal(index.placements.query({ left: 0, top: 16, right: 16, bottom: 32 })[0].id, 'boundary'); assert.equal(index.rule(1000, 1000, 'moisture'), .8);
});

test('zone priorities compose per property; zero delegated NPCs still allow manual spawns', () => {
  const d = newWorldDocument(); grass(d, 0, 0);
  d.zones.push({ id: 'base', name: 'Base', priority: 0, shape: { kind: 'rect', x: 0, y: 0, width: 16, height: 16 }, temperature: .1, moisture: .8, pvp: false,
    npcs: { density: 0, maxPerChunk: 24, weights: { slime: 100, wisp: 0, sentinel: 0 } } },
  { id: 'override', name: 'Override', priority: 10, shape: { kind: 'rect', x: 0, y: 0, width: 4, height: 4 }, temperature: .9, pvp: true });
  d.npcs.push({ id: 'fixed', npcKind: 'wisp', x: 8, y: 8, level: 7 }); const world = new World(42, 16, 'world', d, []);
  assert.equal(world.getTemperature(1, 1), .9); assert.equal(world.getMoisture(48, 48), .8); assert.equal(world.pvpAt(48, 48), true); assert.equal(world.pvpAt(8 * 48, 8 * 48), false);
  assert.deepEqual(world.getChunk(0, 0).npcs.map(n => n.id), ['authored:fixed']);
  d.zones[0].npcs = { density: 1, maxPerChunk: 5, weights: { slime: 0, wisp: 100, sentinel: 0 } };
  assert.ok(new World(42, 16, 'world', d, []).getChunk(0, 0).npcs.filter(n => !n.id.startsWith('authored:')).every(n => n.npcKind === 'wisp'));
});

test('brush transactions interpolate fast strokes, index large catalogs and retain tombstones after erasing', () => {
  const d = newWorldDocument(), a = newWorldAsset('tree', 'Albero', '/world-assets/tree.svg'); d.assets.push(a);
  for (let i = 0; i < 20000; i++) d.placements.push({ id: `tree-${i}`, assetId: a.id, x: i * 4, y: 100 });
  const brush = new WorldBrush(d); assert.equal(brush.stamp(a, { x: 0, y: 100 }, 'duplicate'), false);
  brush.erase({ x: 0, y: 100 }); assert.equal(brush.stamp(a, { x: 0, y: 100 }, 'replacement'), true);
  brush.erase({ x: 0, y: 100 }); assert.equal(d.placements.length, 19999);
  for (const p of strokeTiles({ x: -5, y: 0 }, { x: 5, y: 0 })) brush.tile(p, { terrain: 'path' });
  assert.equal(d.tiles.filter(t => t.terrain === 'path').length, 11); brush.tile({ x: -5, y: 0 }); assert.equal(d.tiles.filter(t => t.terrain === 'path').length, 10);
  assert.doesNotThrow(() => parseWorldDocument(d));
});

test('dungeon relocation translates all authored geometry and preserves boss identity', () => {
  const source = engineBundle().definition, origin = { x: -128, y: 640 }, shifted = relocateDungeon(source, origin), dx = (origin.x - source.layout.bounds.minTx) * 48, dy = (origin.y - source.layout.bounds.minTy) * 48;
  assertValidDungeonDefinition(shifted); assert.equal(shifted.bossId, source.bossId); assert.equal(shifted.layout.bounds.minTx, origin.x);
  assert.equal(shifted.spawnPoints.boss.x, source.spawnPoints.boss.x + dx);
  assert.equal(shifted.encounter.activationPoints![0].y, source.encounter.activationPoints![0].y + dy);
  assert.equal(shifted.approach.from.x, source.approach.from.x + dx);
  const old = source.passages.find(p => p.fightState === 'flame')!, moved = shifted.passages.find(p => p.id === old.id)!;
  if (old.fightState === 'flame' && moved.fightState === 'flame') assert.equal(moved.flame.x, old.flame.x + dx);
  assert.equal(source.layout.bounds.minTx, 256);
});

test('mixed footprint bands never overlap or violate spacing, and a large asset does not collapse small-asset density', () => {
  const d = newWorldDocument(), small = newWorldAsset('small', 'Pianta', '/world-assets/small.svg'), large = newWorldAsset('large', 'Albero', '/world-assets/large.svg');
  small.generation.enabled = true; small.generation.density = .5; small.generation.spacing = 0;
  resizeWorldAsset(large, 8, 6); large.generation.enabled = true; large.generation.density = .1; large.generation.spacing = 3;
  d.assets.push(small);
  const bounds = { left: -64, top: -64, right: 64, bottom: 64 }, baseline = new WorldAuthoring(d).assetsIn(bounds, environment, 42).length;
  d.assets.push(large); const index = new WorldAuthoring(d), placements = index.assetsIn(bounds, environment, 42);
  assert.ok(placements.filter(p => p.assetId === small.id).length > baseline * .7);
  const buckets = new Map<string, typeof placements>();
  for (const p of placements) {
    const a = index.assets.get(p.assetId)!, gap = a.generation.spacing;
    for (let y = Math.floor((p.y - 3) / 16); y <= Math.floor((p.y + a.rows + 3) / 16); y++) for (let x = Math.floor((p.x - 3) / 16); x <= Math.floor((p.x + a.columns + 3) / 16); x++) {
      const key = `${x},${y}`, bucket = buckets.get(key) ?? [];
      for (const q of bucket) {
        const b = index.assets.get(q.assetId)!, padding = Math.max(gap, b.generation.spacing);
        assert.ok(!(p.x - padding < q.x + b.columns && p.x + a.columns + padding > q.x && p.y - padding < q.y + b.rows && p.y + a.rows + padding > q.y), `${p.id} overlaps ${q.id}`);
      }
      bucket.push(p); buckets.set(key, bucket);
    }
  }
  const other = new WorldAuthoring(d); other.assetsIn({ left: 0, top: 128, right: 64, bottom: 192 }, environment, 42);
  assert.deepEqual(other.assetsIn(bounds, environment, 42), placements);
});

test('different authored entrances never pair players across gates even when they lead to the same arena', () => {
  const d = newWorldDocument(); grass(d, 98, 98, 16, 8);
  d.zones.push({ id: 'no-population', name: 'Prova senza NPC', priority: -10, shape: { kind: 'rect', x: -100, y: -100, width: 300, height: 300 }, npcs: { density: 0, maxPerChunk: 0, weights: { slime: 0, wisp: 0, sentinel: 0 } } });
  d.zones.push({ id: 'a', name: 'Ingresso A', priority: 0, shape: { kind: 'circle', x: 100, y: 100, radius: 2 }, arenaId: 'arena-1', pvp: false },
    { id: 'b', name: 'Ingresso B', priority: 0, shape: { kind: 'circle', x: 110, y: 100, radius: 2 }, arenaId: 'arena-1', pvp: false });
  const manager = new RoomManager(undefined, 42, 1_000_000);
  Object.defineProperty(manager.global, 'world', { value: new World(42, 16, 'world', d, []) });
  for (const id of ['a1', 'b1', 'a2']) manager.connect({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 }, 'mage');
  for (let i = 0; i < 110; i++) manager.step(.1);
  Object.assign(manager.global.players.get('a1')!, { x: 100 * 48, y: 100 * 48 }); Object.assign(manager.global.players.get('b1')!, { x: 110 * 48, y: 100 * 48 });
  for (let i = 0; i < 40; i++) manager.step(.1);
  assert.equal(manager.rooms.size, 0); assert.equal(manager.gateStateFor('a1')!.players, 1); assert.equal(manager.gateStateFor('b1')!.players, 1);
  Object.assign(manager.global.players.get('a2')!, { x: 100 * 48 + 40, y: 100 * 48 });
  for (let i = 0; i < 32; i++) manager.step(.1);
  assert.equal(manager.rooms.size, 1); assert.equal(manager.stateFor('a1').id, manager.stateFor('a2').id); assert.equal(manager.stateFor('b1').id, 'world');
});
