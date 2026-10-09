import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoomManager } from '../server/rooms';
import { AccountStore, type Account } from '../server/store';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { atWarp, mapDocument, newInterior, newDungeonInterior, warpPosition, setWarpReturn } from '../shared/warps';
import { INSTALLED_DUNGEON_DEFINITIONS } from '../shared/dungeons';
import { World } from '../shared/world';
import { validateWorld, worldDungeons } from '../shared/world-validation';
import { WORLD_DOCUMENT } from '../shared/world-content';
import { TILE_SIZE } from '../shared/config';
import { serializeWorldDocument, compactWorldTiles } from '../shared/world-tiles';
import { WorldBrush, forkWorldDocument } from '../shared/world-editing';
import { WorldEditorHistory } from '../client/editors/world/world-editor-history';
import type { GameplayPersistence } from '../server/gameplay-persistence';

function warpProject() {
  const p = newWorldDocument(734291); p.spawn = { x: 10, y: 10 };
  p.dungeons = INSTALLED_DUNGEON_DEFINITIONS.map(d => ({ dungeonId: d.id, x: 0, y: 0, enabled: false }));
  p.zones = [{ id: 'safe', name: 'Test', priority: 1, shape: { kind: 'rect', x: 0, y: 0, width: 24, height: 24 },
    pvp: false, generateAssets: false, npcs: { density: 0, maxPerChunk: 0, weights: { slime: 0, wisp: 0, sentinel: 0 } } }];
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) p.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  p.interiors = [newInterior('house', 'La locanda', 24, 18)];
  p.warps = [
    { id: 'door-a', name: 'Porta principale', from: 'world', to: 'house', entry: { x: 2, y: 2 }, arrival: { x: 4, y: 4 }, activation: 'walk' },
    { id: 'door-b', name: 'Porta laterale', from: 'world', to: 'house', entry: { x: 7, y: 2 }, arrival: { x: 14, y: 4 }, activation: 'interact' },
    { id: 'exit-a', name: 'Esci', from: 'house', to: 'world', entry: { x: 4, y: 7 }, arrival: { x: 3, y: 6 }, activation: 'walk' },
    { id: 'exit-b', name: 'Passaggio segreto', from: 'house', to: 'world', entry: { x: 14, y: 7 }, arrival: { x: 9, y: 6 }, activation: 'interact' },
  ]; return p;
}
const account = (id: string): Account => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });
function advance(m: RoomManager, seconds = .5) { for (let i = 0; i < Math.ceil(seconds / .05); i++) m.step(.05); }
function enter(m: RoomManager, id: string, warpId: string) {
  const w = m.project.warps!.find(w => w.id === warpId)!;
  Object.assign(m.simulationFor(id).players.get(id)!, warpPosition(w.entry));
  if (w.activation === 'interact') { const state = m.stateFor(id); m.interact(id, { kind: 'warp', warpId }, state.id, state.epoch); }
  advance(m);
}

test('internal map has bounded terrain, shared assets, authored NPCs and no random population', () => {
  const p = warpProject(), d = mapDocument(p, 'house'), world = new World(p.seed, 16, 'world', d, []);
  assert.equal(world.getTile(4, 4), 'grass'); assert.equal(world.getTile(-1, 4), 'rock'); assert.equal(world.getTile(24, 4), 'rock');
  assert.equal(world.pvpAt(200, 200), false); assert.equal(world.locationAt(200, 200), 'La locanda');
  assert.equal(world.authoring.document.assets, p.assets);
  for (let x = -1; x < 2; x++) for (let y = -1; y < 2; y++) { assert.equal(world.getChunk(x, y).npcs.length, 0); assert.equal(world.getChunk(x, y).pickups.length, 0); }
});

test('interior PvP persists, defaults to safe, and explicit zones override its rule', () => {
  const p = warpProject(), interior = p.interiors![0];
  interior.pvp = true; interior.kind = 'dungeon';
  const parsed = parseWorldDocument(p); assert.equal(parsed.interiors![0].pvp, true); assert.equal(parsed.interiors![0].kind, 'dungeon');
  const d = mapDocument(parsed, 'house');
  d.zones = [{ id: 'safe-corner', name: 'Ingresso sicuro', priority: 1, pvp: false, shape: { kind: 'rect', x: 0, y: 0, width: 2, height: 2 } }];
  const world = new World(p.seed, 16, 'world', d, []);
  assert.equal(world.pvpAt(24, 24), false); assert.equal(world.pvpAt(200, 200), true);
  interior.pvp = false;
  const safe = new World(p.seed, 16, 'world', mapDocument(p, 'house'), []); assert.equal(safe.pvpAt(200, 200), false);
  const invalid = structuredClone(p); (invalid.interiors![0] as any).pvp = 'true'; assert.throws(() => parseWorldDocument(invalid), /mappa interna/);
});

test('dungeon interiors relocate the complete encounter and use map PvP or a dungeon override', () => {
  const p = warpProject(), source = INSTALLED_DUNGEON_DEFINITIONS[0];
  p.assets = structuredClone(WORLD_DOCUMENT.assets);
  const interior = newDungeonInterior('crypt', source, true, p.seed); p.interiors = [interior];
  assert.equal(interior.kind, 'dungeon'); assert.equal(interior.pvp, true);
  const d = mapDocument(p, interior.id), definitions = worldDungeons(d, INSTALLED_DUNGEON_DEFINITIONS);
  assert.equal(worldDungeons(p, INSTALLED_DUNGEON_DEFINITIONS).length, 0);
  assert.equal(definitions[0].layout.bounds.minTx, 2); assert.equal(definitions[0].layout.bounds.minTy, 2);
  const point = warpPosition({ x: 4, y: 4 });
  assert.equal(new World(p.seed, 16, 'world', d, definitions).pvpAt(point.x, point.y), true);
  d.dungeons[0].pvp = false;
  assert.equal(new World(p.seed, 16, 'world', d, definitions).pvpAt(point.x, point.y), false);
  assert.equal(new World(p.seed, 16, 'world', d, definitions).pvpAt(24, 24), true);
  // Dungeon overrides work on the open world too; unrelated space retains its default.
  p.interiors = []; p.warps = []; p.dungeons = [{ dungeonId: source.id, x: 30, y: 30, pvp: false }];
  const outside = new World(p.seed, 16, 'world', p, worldDungeons(p, [source]));
  assert.equal(outside.pvpAt(32 * TILE_SIZE, 32 * TILE_SIZE), false); assert.equal(outside.pvpAt(-1000, -1000), true);
  assert.equal(parseWorldDocument(p).dungeons[0].pvp, false);
});

test('multiple doors share an interior and exits lead to their explicit destinations without resetting the character', () => {
  const p = warpProject(), m = new RoomManager(undefined, p.seed, 1_000_000, p), a = account('traveller'), b = account('friend');
  m.connect(a, 'warrior'); m.connect(b, 'warrior'); advance(m, .1);
  const original = m.global.players.get(a.id)!; original.hp = 100; original.resource = 30; original.cooldowns.q = m.global.now + 5000;
  const inventory = JSON.stringify(a.inventory), narrative = JSON.stringify(a.narrative), maxHp = original.maxHp;
  const oldState = m.stateFor(a.id);
  enter(m, a.id, 'door-a');
  assert.equal(m.stateFor(a.id).mapId, 'house'); assert.equal(m.global.players.has(a.id), false);
  const indoor = m.simulationFor(a.id).players.get(a.id)!;
  assert.deepEqual({ x: indoor.x, y: indoor.y }, warpPosition(p.warps![0].arrival));
  assert.equal(indoor.maxHp, maxHp); assert.equal(indoor.hp, 100); assert.equal(indoor.cooldowns.q, original.cooldowns.q);
  assert.equal(JSON.stringify(a.inventory), inventory); assert.equal(JSON.stringify(a.narrative), narrative);
  assert.equal(m.enqueueInput(a.id, { seq: 1, dx: 1, dy: 0, aim: 0 }, oldState.id, oldState.epoch), true);
  assert.equal(m.simulationFor(a.id).connections.get(a.id)!.inputs.length, 0);
  enter(m, b.id, 'door-b'); assert.equal(m.simulationFor(a.id), m.simulationFor(b.id));
  assert.equal(m.simulationFor(b.id).snapshotFor(b.id)!.actors.some(actor => actor.id === a.id), true);
  enter(m, a.id, 'exit-b'); assert.equal(m.stateFor(a.id).id, 'world'); assert.equal(a.location, undefined);
  const returned = m.global.players.get(a.id)!;
  assert.deepEqual({ x: returned.x, y: returned.y }, warpPosition(p.warps![3].arrival));
  advance(m, 1); assert.equal(m.stateFor(a.id).id, 'world');
});

test('server validates proximity, source map, combat and destination; movement is consumed during the fade', () => {
  const p = warpProject(), m = new RoomManager(undefined, p.seed, 1_000_000, p), a = account('traveller');
  m.connect(a, 'mage'); advance(m, .1); const state = m.stateFor(a.id);
  assert.throws(() => m.interact(a.id, { kind: 'warp', warpId: 'door-b' }, state.id, state.epoch), /Avvicinati/);
  assert.throws(() => m.interact(a.id, { kind: 'warp', warpId: 'exit-b' }, state.id, state.epoch), /non disponibile/);
  const actor = m.global.players.get(a.id)!; Object.assign(actor, warpPosition(p.warps![1].entry));
  actor.pvpUntil = m.global.now + 1000;
  assert.throws(() => m.interact(a.id, { kind: 'warp', warpId: 'door-b' }, state.id, state.epoch), /combattimento/);
  actor.pvpUntil = 0;
  m.interact(a.id, { kind: 'warp', warpId: 'door-b' }, state.id, state.epoch);
  assert.equal(m.takeWarpTransition(a.id)?.phase, 'start');
  assert.equal(m.enqueueInput(a.id, { seq: 1, dx: 1, dy: 0, aim: 0, cast: 'q' }, state.id, state.epoch), true);
  assert.equal(m.global.connections.get(a.id)!.inputs.length, 0); assert.equal(m.global.connections.get(a.id)!.ack, 1);
  advance(m); assert.equal(m.stateFor(a.id).mapId, 'house');
});

test('internal location and progress survive disconnect, save and restart; a removed map recovers in the world', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'riftlands-warp-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = warpProject(), store = new AccountStore(join(dir, 'accounts.json')), a = store.register('Traveller', 'test-password').account;
  const m = new RoomManager(store, p.seed, 1_000_000, p); m.connect(a, 'mage'); advance(m, .1); enter(m, a.id, 'door-a'); await Promise.resolve(); advance(m);
  a.gold = 123; m.checkpoint(); store.touch(); store.flush(); m.disconnect(a.id, true); advance(m, 21);
  m.connect(a, 'mage'); assert.equal(m.stateFor(a.id).mapId, 'house'); assert.equal(a.gold, 123);
  const saved = new AccountStore(store.path), reloaded = saved.accounts.get(a.id)!;
  const restarted = new RoomManager(saved, p.seed, m.global.now + 1000, p); restarted.connect(reloaded, 'mage');
  assert.equal(restarted.stateFor(a.id).mapId, 'house');
  const removed = structuredClone(p); removed.interiors = []; removed.warps = [];
  const returnTo = { ...reloaded.location!.returnTo };
  const recovery = new RoomManager(undefined, p.seed, m.global.now + 2000, removed);
  recovery.connect(reloaded, 'mage'); assert.equal(recovery.stateFor(a.id).id, 'world'); assert.equal(reloaded.location, undefined);
  assert.deepEqual({ x: recovery.global.players.get(a.id)!.x, y: recovery.global.players.get(a.id)!.y }, returnTo);
  advance(recovery); assert.equal(recovery.stateFor(a.id).id, 'world');
});

test('project export keeps root and internal tiles separate, including undo of internal edits', () => {
  const p = compactWorldTiles(warpProject()); p.interiors![0].document = compactWorldTiles(p.interiors![0].document);
  const history = new WorldEditorHistory(), before = forkWorldDocument(p), after = forkWorldDocument(p);
  const brush = new WorldBrush(after.interiors![0].document, true); brush.tile({ x: 9, y: 9 }, { terrain: 'water', suppressAssets: true }); brush.flushTiles();
  assert.equal(history.commit(before, after), true);
  const parsed = parseWorldDocument(serializeWorldDocument(after));
  assert.equal(new World(p.seed, 16, 'world', mapDocument(parsed, 'house'), []).getTile(9, 9), 'water');
  assert.equal(new World(p.seed, 16, 'world', parsed, []).getTile(9, 9), 'grass');
  const undone = history.undo(after);
  assert.equal(new World(p.seed, 16, 'world', mapDocument(undone, 'house'), []).getTile(9, 9), 'grass');
  assert.deepEqual(parsed.warps, p.warps);
});

test('installation permits arrivals on doors and missing exits but rejects obstacles and invalid map references', () => {
  const p = warpProject(); p.dungeons = []; assert.deepEqual(validateWorld(p, []), []);
  const missing = structuredClone(p); missing.warps = missing.warps!.filter(w => w.from !== 'house');
  assert.deepEqual(validateWorld(missing, []), []);
  const loop = structuredClone(p); loop.warps![0].arrival = { ...loop.warps![2].entry };
  assert.deepEqual(validateWorld(loop, []), []);
  const wall = structuredClone(p); wall.warps![0].arrival = { x: -1, y: 3 };
  assert.ok(validateWorld(wall, []).some(s => s.includes('arrivo su un ostacolo')));
  const invalid = structuredClone(p); invalid.warps![0].to = 'missing';
  assert.throws(() => parseWorldDocument(invalid), /warp/);
});

test('multiple floors, isolated interiors and one-way destinations do not require world access', () => {
  const p = warpProject(); p.dungeons = []; p.interiors!.push(newInterior('upper', 'Primo piano', 24, 18));
  const stairs = { id: 'stairs', name: 'Scale', from: 'house', to: 'upper', entry: { x: 10, y: 10 }, arrival: { x: 5, y: 5 }, activation: 'walk' as const };
  p.warps!.push(stairs); setWarpReturn(p, stairs, true, 'stairs-back');
  assert.deepEqual(validateWorld(p, []), []);
  const trapped = structuredClone(p); trapped.warps = trapped.warps!.filter(w => w.id !== 'stairs-back'); delete trapped.warps!.find(w => w.id === 'stairs')!.reverseId;
  assert.deepEqual(validateWorld(trapped, []), []);
  const isolated = structuredClone(p); isolated.warps = isolated.warps!.filter(w => w.from !== 'upper' && w.to !== 'upper');
  assert.deepEqual(validateWorld(isolated, []), []);
  const indoorOnly = structuredClone(p); indoorOnly.warps = indoorOnly.warps!.filter(w => w.from !== 'world' && w.to !== 'world');
  assert.deepEqual(validateWorld(indoorOnly, []), []);
  indoorOnly.warps = []; assert.deepEqual(validateWorld(indoorOnly, []), []);
});

test('a paired door stays armed only after leaving, in both directions and for explicit interaction', () => {
  for (const activation of ['walk', 'interact'] as const) {
    const p = warpProject(); p.warps = [p.warps![0]]; p.warps[0].activation = activation;
    setWarpReturn(p, p.warps[0], true, 'return');
    const m = new RoomManager(undefined, p.seed, 1_000_000, p), a = account('traveller');
    m.connect(a, 'warrior'); advance(m, .1); enter(m, a.id, 'door-a');
    advance(m, 2); assert.equal(m.stateFor(a.id).mapId, 'house');
    if (activation === 'interact') {
      const state = m.stateFor(a.id);
      assert.throws(() => m.interact(a.id, { kind: 'warp', warpId: 'return' }, state.id, state.epoch), /Allontanati/);
    }
    Object.assign(m.simulationFor(a.id).players.get(a.id)!, warpPosition({ x: 10, y: 10 })); advance(m, .1);
    enter(m, a.id, 'return'); advance(m, 2); assert.equal(m.stateFor(a.id).id, 'world');
    assert.deepEqual({ x: m.global.players.get(a.id)!.x, y: m.global.players.get(a.id)!.y }, warpPosition(p.warps[0].entry));
    Object.assign(m.global.players.get(a.id)!, warpPosition({ x: 10, y: 10 })); advance(m, .1);
    enter(m, a.id, 'door-a'); assert.equal(m.stateFor(a.id).mapId, 'house');
  }
});

test('paired authoring edits both sides, survives parsing and can become one way', () => {
  const p = warpProject(); p.dungeons = []; p.warps = [p.warps![0]]; const w = p.warps[0];
  setWarpReturn(p, w, true, 'return'); assert.equal(p.warps.length, 2);
  w.arrival = { x: 9, y: 8 }; w.entry = { x: 3, y: 3 }; setWarpReturn(p, w, true, 'unused');
  assert.equal(p.warps.length, 2); assert.deepEqual(p.warps[1].entry, w.arrival); assert.deepEqual(p.warps[1].arrival, w.entry);
  assert.deepEqual(parseWorldDocument(p).warps, p.warps); assert.deepEqual(validateWorld(p, []), []);
  const broken = structuredClone(p); broken.warps![1].entry.x++;
  assert.ok(validateWorld(broken, []).some(issue => issue.includes('non coerente')));
  setWarpReturn(p, w, false, ''); assert.equal(p.warps.length, 1); assert.equal(w.reverseId, undefined);
});

test('warp waits for durable saves and rolls back a failed commit without duplicating the player', async () => {
  const p = warpProject(), a = account('traveller'); let release!: () => void, fail = false;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const store: GameplayPersistence = { accounts: new Map([[a.id, a]]), bossStates: {}, touch() {}, flushBosses() {},
    flush() { if (fail) throw new Error('Disco non disponibile'); }, drain: () => barrier };
  const m = new RoomManager(store, p.seed, 1_000_000, p); m.connect(a, 'warrior'); advance(m, .1);
  const actor = m.global.players.get(a.id)!; Object.assign(actor, warpPosition(p.warps![1].entry)); actor.hp = 100;
  const state = m.stateFor(a.id); m.interact(a.id, { kind: 'warp', warpId: 'door-b' }, state.id, state.epoch);
  advance(m, 2); assert.equal(m.stateFor(a.id).id, 'world');
  assert.equal(m.global.players.has(a.id), true); assert.equal(m.interiors.get('house')!.players.has(a.id), false);
  release(); await Promise.resolve(); fail = true; advance(m);
  assert.equal(m.stateFor(a.id).id, 'world'); assert.equal(a.location, undefined);
  assert.equal(m.global.players.get(a.id)!.hp, 100); assert.equal(m.interiors.get('house')!.players.has(a.id), false);
  assert.equal(m.takeWarpTransition(a.id)?.phase, 'cancel'); assert.match(m.takeNotice(a.id)!, /Disco/);
});

test('damage during the fade cancels the warp and re-arms only after leaving the entrance', () => {
  const p = warpProject(), a = account('traveller'), m = new RoomManager(undefined, p.seed, 1_000_000, p);
  m.connect(a, 'warrior'); advance(m, .1); const actor = m.global.players.get(a.id)!;
  Object.assign(actor, warpPosition(p.warps![0].entry)); advance(m, .05);
  actor.pvpUntil = m.global.now + 1000; advance(m, .5);
  assert.equal(m.stateFor(a.id).id, 'world'); assert.equal(m.takeWarpTransition(a.id)?.phase, 'cancel');
  actor.pvpUntil = 0; advance(m); assert.equal(m.stateFor(a.id).id, 'world');
  Object.assign(actor, warpPosition({ x: 10, y: 10 })); advance(m, .1);
  enter(m, a.id, 'door-a'); assert.equal(m.stateFor(a.id).mapId, 'house');
});

test('an installed dungeon can live indoors with its boss and disappear from the open world', () => {
  const p = warpProject(), definition = INSTALLED_DUNGEON_DEFINITIONS[0];
  p.assets = structuredClone(WORLD_DOCUMENT.assets);
  const m = newInterior('crypt', 'Cripta', 56, 40); m.document.dungeons = [{ dungeonId: definition.id, x: 10, y: 10 }];
  p.interiors = [m];
  const dungeon = worldDungeons(mapDocument(p, m.id), INSTALLED_DUNGEON_DEFINITIONS)[0];
  const world = new World(p.seed, 16, 'world', mapDocument(p, m.id), [dungeon]), b = dungeon.layout.bounds;
  const cells = Array.from({ length: (b.maxTx - b.minTx + 1) * (b.maxTy - b.minTy + 1) }, (_, index) =>
    ({ x: b.minTx + index % (b.maxTx - b.minTx + 1), y: b.minTy + Math.floor(index / (b.maxTx - b.minTx + 1)) }));
  const arrival = cells.find(cell => !world.isBlocked(cell.x, cell.y))!; assert.ok(arrival); m.document.spawn = { ...arrival };
  p.warps = [
    { id: 'enter', name: 'Ingresso cripta', from: 'world', to: m.id, entry: { x: 2, y: 2 }, arrival, activation: 'interact' },
    { id: 'exit', name: 'Uscita cripta', from: m.id, to: 'world', entry: { x: 2, y: 2 }, arrival: { x: 2, y: 5 }, activation: 'walk' },
  ];
  assert.equal(worldDungeons(p, INSTALLED_DUNGEON_DEFINITIONS).length, 0);
  assert.deepEqual(validateWorld(p, INSTALLED_DUNGEON_DEFINITIONS), []);
  const manager = new RoomManager(undefined, p.seed, 1_000_000, p), a = account('traveller');
  manager.connect(a, 'mage'); advance(manager, .1); enter(manager, a.id, 'enter');
  assert.equal(manager.stateFor(a.id).mapId, m.id);
  assert.equal(manager.global.bosses.size, 0);
  assert.ok(manager.simulationFor(a.id).bosses.has(dungeon.bossId));
  assert.equal(manager.simulationFor(a.id).world.getTile(-1, 5), 'rock');
});
