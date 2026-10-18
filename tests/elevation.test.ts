import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/world';
import { TILE_SIZE } from '../shared/config';
import { newWorldDocument, newWorldAsset, parseWorldDocument } from '../shared/world-schema';
import { emptyGeometry, circleSupported, placedGeometry } from '../shared/elevation';
import { collidesWorld, moveWithCollisions, hasLineOfSight, resolveActorCollisions } from '../shared/physics';
import { sweptWorldHit } from '../shared/projectiles';
import { forkWorldDocument } from '../shared/world-editing';
import { WorldEditorHistory } from '../client/editors/world/world-editor-history';
import { serializeWorldDocument } from '../shared/world-tiles';
import { projectActor } from '../shared/snapshot-actor';
import type { TileKind, Actor } from '../shared/types';
import { removeGeometry } from '../shared/elevation-editing';
import { WorldSimulation } from '../server/simulation';
import { reconcile } from '../client/core/prediction';
import { validateWorld } from '../shared/world-validation';
import { atWarp, setWarpReturn } from '../shared/warps';

function fixture() {
  const document = newWorldDocument(1); document.geometry = emptyGeometry();
  class FlatWorld extends World {
    override getTile(x: number, y: number): TileKind { return document.tiles.find(t => t.x === x && t.y === y)?.terrain ?? 'grass'; }
  }
  return { document, world: () => new FlatWorld(1, 16, 'world', document, []) };
}
const p = (x: number, y: number, elevation = 0) => ({ x: x * TILE_SIZE, y: y * TILE_SIZE, elevation });
test('signed floors and fractional geometry survive import, serialization and history', () => {
  const { document } = fixture();
  const history = new WorldEditorHistory(), before = forkWorldDocument(document);
  document.geometry!.surfaces.push({ id: 'underground', x: -2.25, y: 0, width: 2, height: 1, elevation: -14 });
  history.commit(before, document);
  assert.deepEqual(parseWorldDocument(serializeWorldDocument(document)).geometry, document.geometry);
  assert.equal(history.undo(document).geometry!.surfaces.length, 0);
  assert.equal(history.redo(before).geometry!.surfaces[0].elevation, -14);
  for (const value of [1.5, -129, 128, NaN]) {
    const copy = structuredClone(document); copy.geometry!.surfaces[0].elevation = value;
    assert.throws(() => parseWorldDocument(copy));
  }
});
test('cliff prevents crossing both ways while shots above the lower floor continue', () => {
  const { document, world } = fixture();
  document.geometry!.surfaces.push({ id: 'top', x: 2, y: -2, width: 3, height: 4, elevation: 1 });
  document.geometry!.solids.push({ id: 'mountain', x: 2, y: -2, width: 3, height: 4, base: 0, top: 1 });
  const w = world();
  assert.ok(moveWithCollisions({ ...p(1, 0), radius: 6 }, 1, 0, 150, w).x < 2 * TILE_SIZE);
  assert.ok(moveWithCollisions({ ...p(3, 0, 1), radius: 6 }, -1, 0, 150, w).x > 2 * TILE_SIZE);
  assert.equal(sweptWorldHit(p(3, 0), p(0, 0), 2, w, 1), null);
  assert.notEqual(sweptWorldHit(p(0, 0), p(3, 0), 2, w, 0), null);
});
test('stairs change floor deterministically in both directions including replay and small steps', () => {
  const { document, world } = fixture();
  document.geometry!.surfaces.push({ id: 'top', x: 2, y: -2, width: 5, height: 4, elevation: 14 });
  document.geometry!.solids.push({ id: 'mountain-mass', x: 2, y: -2, width: 5, height: 4, base: 0, top: 14 });
  document.geometry!.stairs.push({ id: 'stairs', x: 1, y: -1, width: 2, height: 2, from: 0, to: 14, axis: 'x' });
  const w = world(), start = { ...p(.5, 0), radius: 6 };
  const up = moveWithCollisions(start, 1, 0, TILE_SIZE * 3, w);
  assert.equal(up.elevation, 14); assert.ok(up.x > 3 * TILE_SIZE);
  const down = moveWithCollisions({ ...up, radius: 6 }, -1, 0, TILE_SIZE * 3, w);
  assert.equal(down.elevation, 0); assert.ok(down.x < TILE_SIZE);
  assert.deepEqual(moveWithCollisions(start, 1, 0, TILE_SIZE * 3, w), up);
  let state = start;
  for (let i = 0; i < 72; i++) state = { ...state, ...moveWithCollisions(state, 1, 0, 2, w) };
  assert.equal(state.elevation, 14);
});
test('water remains impassable from land but does not stop horizontal shots', () => {
  const { document, world } = fixture(); document.tiles.push({ x: 1, y: 0, terrain: 'water' });
  const w = world();
  assert.equal(w.elevation.baseAt(1, 0), -1);
  assert.equal(collidesWorld(TILE_SIZE * 1.5, TILE_SIZE * .5, 5, w), true);
  assert.equal(sweptWorldHit(p(.5, .5), p(2.5, .5), 2, w, 0), null);
});
test('negative surfaces require stairs to descend and return to floor zero', () => {
  const { document, world } = fixture();
  document.geometry!.surfaces.push({ id: 'lower', x: 2, y: -1, width: 4, height: 2, elevation: -1, ground: true });
  document.geometry!.stairs.push({ id: 'downstairs', x: 1, y: -1, width: 2, height: 2, from: 0, to: -1, axis: 'x' });
  const w = world();
  const down = moveWithCollisions({ ...p(.5, 0), radius: 6 }, 1, 0, TILE_SIZE * 3, w);
  assert.equal(down.elevation, -1);
  const up = moveWithCollisions({ ...down, radius: 6 }, -1, 0, TILE_SIZE * 3, w);
  assert.equal(up.elevation, 0);
});
test('rocks are one floor above their underlying surface, including elevated terrain', () => {
  const { document, world } = fixture();
  document.geometry!.surfaces.push({ id: 'ledge', x: 1, y: 0, width: 1, height: 1, elevation: 5, ground: true, terrain: 'rock' });
  const w = world();
  assert.notEqual(sweptWorldHit(p(.5, .5), p(2.5, .5), 1, w, 5), null);
  assert.equal(sweptWorldHit(p(.5, .5), p(2.5, .5), 1, w, 6), null);
});
test('a bridge at floor one leaves both movement and projectiles at floor zero unobstructed', () => {
  const { document, world } = fixture();
  document.geometry!.surfaces.push({ id: 'deck', x: 0, y: 0, width: 4, height: 2, elevation: 1 });
  const w = world();
  for (const e of [0, 1]) {
    assert.equal(collidesWorld(TILE_SIZE, TILE_SIZE, 5, w, e), false);
    assert.equal(sweptWorldHit(p(.5, 1), p(3.5, 1), 2, w, e), null);
  }
});
test('partial ground mask replaces procedural rock only inside its footprint', () => {
  const { document, world } = fixture(); document.tiles.push({ x: 1, y: 0, terrain: 'rock' });
  document.geometry!.surfaces.push({ id: 'ledge', x: 1, y: 0, width: .5, height: 1, elevation: 5, ground: true, terrain: 'grass' });
  const w = world();
  assert.equal(collidesWorld(TILE_SIZE * 1.25, TILE_SIZE * .5, 2, w, 5), false);
  assert.notEqual(sweptWorldHit(p(1.75, -.5), p(1.75, 1.5), 1, w, 0), null);
  assert.equal(sweptWorldHit(p(1.25, -.5), p(1.25, 1.5), 1, w, 0), null);
});
test('a bridge shares XY with the lower surface; pillars block only their footprint', () => {
  const { document, world } = fixture();
  document.geometry!.surfaces.push({ id: 'bridge', x: 0, y: 0, width: 4, height: 2, elevation: 3 });
  document.geometry!.solids.push({ id: 'deck', x: 0, y: 0, width: 4, height: 2, base: 2, top: 3 },
    { id: 'pillar', x: 1, y: 0, width: .25, height: .25, base: 0, top: 3 });
  const w = world();
  for (const e of [0, 3]) assert.equal(collidesWorld(TILE_SIZE, TILE_SIZE, 5, w, e), false);
  assert.equal(w.elevation.at(TILE_SIZE, TILE_SIZE, 0).elevation, 0);
  assert.equal(w.elevation.at(TILE_SIZE, TILE_SIZE, 3).surfaceId, 'bridge');
  assert.equal(collidesWorld(TILE_SIZE * 1.1, TILE_SIZE * .1, 2, w, 0), true);
  assert.equal(sweptWorldHit(p(.5, 1), p(3.5, 1), 1, w, 0), null);
  assert.notEqual(sweptWorldHit(p(.5, 1), p(3.5, 1), 1, w, 2), null);
});
test('subtile rectangles allow passage beside walls and stop fast projectiles', () => {
  const { document, world } = fixture();
  document.geometry!.solids.push({ id: 'wall', x: 1, y: 0, width: .25, height: .5, base: 0, top: 2 });
  const w = world();
  assert.equal(sweptWorldHit(p(0, .75), p(3, .75), 1, w), null);
  assert.notEqual(sweptWorldHit(p(0, .25), p(30, .25), 1, w), null);
  assert.equal(collidesWorld(TILE_SIZE * 1.5, TILE_SIZE * .25, 2, w), false);
});
test('support must cover the whole circular footprint, including gaps between rectangles', () => {
  const rect = { id: 'support', x: 0, y: 0, width: 2, height: 1 };
  assert.equal(circleSupported(1, .5, .4, [rect]), true);
  assert.equal(circleSupported(1, .5, .6, [rect]), false);
  assert.equal(circleSupported(1, .5, .4, [{ ...rect, width: .9 }, { ...rect, x: 1.1, width: .9 }]), false);
});
test('assets carry relative platforms, solids and stairs at a per-instance base', () => {
  const { document, world } = fixture(), a = newWorldAsset('bridge', 'Ponte', '/world-assets/test.png');
  a.width = a.height = a.columns = a.rows = 4; a.cells = Array.from({ length: 16 }, () => ({ blocked: false, visibility: 'normal' as const }));
  a.geometry = { surfaces: [{ id: 'top', x: 0, y: 0, width: 4, height: 4, elevation: 1 }],
    solids: [{ id: 'deck', x: 0, y: 0, width: 4, height: 4, base: 0, top: 1 }], stairs: [] };
  document.assets.push(a); document.placements.push({ id: 'instance', assetId: a.id, x: 0, y: 0, baseElevation: 5 });
  const w = world(); assert.equal(collidesWorld(TILE_SIZE, TILE_SIZE, 5, w, 6), false);
  assert.equal(collidesWorld(TILE_SIZE, TILE_SIZE, 5, w, 5), true);
  assert.equal(placedGeometry(a.geometry, 3, 4, -5, 'copy').surfaces[0].elevation, -4);
});
test('line of sight and actor body separation respect floors; snapshots retain elevation', () => {
  const { world } = fixture(), w = world();
  assert.equal(hasLineOfSight(p(0, 0, 0), p(1, 0, 1), w), false);
  const a = { ...p(0, 0, 0), id: 'a', hp: 10, radius: 15 } as Actor;
  const b = { ...a, id: 'b', elevation: 1 };
  resolveActorCollisions([a, b], w); assert.equal(a.x, b.x); assert.equal(a.y, b.y);
  const actor = { ...a, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 }, elevation: -14, surfaceId: 'underground' } as Actor;
  assert.equal(projectActor(actor).elevation, -14); assert.equal(projectActor(actor).surfaceId, 'underground');
});
test('deleting a raised terrain also deletes its linked mass', () => {
  const { document } = fixture();
  document.geometry!.surfaces.push({ id: 'top', x: 0, y: 0, width: 1, height: 1, elevation: 1 });
  document.geometry!.solids.push({ id: 'top-mass', x: 0, y: 0, width: 1, height: 1, base: 0, top: 1 });
  removeGeometry(document, 'surfaces', 'top'); assert.equal(document.geometry!.solids.length, 0);
});
test('server projectile retains its launch floor when the owner changes floors', () => {
  const { world } = fixture();
  const simulation = new WorldSimulation(1, 1_000_000, undefined, 'world', { world: world(), dungeons: [], bosses: new Map(), spawn: { x: 0, y: 0 } });
  const account = (id: string) => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });
  const owner = simulation.addPlayer(account('owner'), 'mage'), low = simulation.addPlayer(account('low'), 'mage'), high = simulation.addPlayer(account('high'), 'mage');
  Object.assign(owner, p(0, 0, 1), { spawnProtectedUntil: 0 });
  Object.assign(low, p(1.5, 0, 0), { spawnProtectedUntil: 0 });
  Object.assign(high, p(3, 0, 1), { spawnProtectedUntil: 0 });
  assert.equal(simulation.cast(owner, 'basic'), true);
  assert.equal([...simulation.projectiles.values()][0].elevation, 1);
  owner.elevation = 0;
  for (let i = 0; i < 15; i++) simulation.step();
  assert.equal(low.hp, low.maxHp); assert.ok(high.hp < high.maxHp);
});
test('reconciliation replays stair changes together with XY and reconnect preserves the floor', () => {
  const { document, world } = fixture();
  document.geometry!.surfaces.push({ id: 'top', x: 2, y: -1, width: 4, height: 3, elevation: 1 });
  document.geometry!.solids.push({ id: 'top-mass', x: 2, y: -1, width: 4, height: 3, base: 0, top: 1 });
  document.geometry!.stairs.push({ id: 'stairs', x: 1, y: -1, width: 2, height: 2, from: 0, to: 1, axis: 'x' });
  const w = world();
  const simulation = new WorldSimulation(1, 1_000_000, undefined, 'world', { world: w, dungeons: [], bosses: new Map(), spawn: { x: 0, y: 0 } });
  const account = { id: 'owner', name: 'Owner', nameLower: 'owner', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 };
  const actor = simulation.addPlayer(account, 'mage'); Object.assign(actor, p(1.9, 0), { speed: 190 });
  const commands = Array.from({ length: 8 }, (_, i) => ({ seq: i + 1, dx: 1, dy: 0, aim: 0 }));
  const predicted = reconcile(actor, 0, commands, w, simulation.now).actor;
  assert.equal(predicted.elevation, 1);
  Object.assign(actor, p(3.5, 0, 1), { surfaceId: 'top' }); simulation.checkpoint(); simulation.detachPlayer(actor.id);
  const reconnected = simulation.addPlayer(account, 'mage'); assert.equal(reconnected.elevation, 1); assert.equal(reconnected.surfaceId, 'top');
});
test('validation catches overlapping floors and stairs without a supported destination', () => {
  const { document } = fixture();
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) document.tiles.push({ x, y, terrain: 'grass' });
  document.geometry!.stairs.push({ id: 'bad-stair', x: 0, y: 0, width: 2, height: 2, from: 0, to: 14, axis: 'x' });
  document.geometry!.surfaces.push({ id: 'a', x: 3, y: 0, width: 2, height: 2, elevation: 1 }, { id: 'b', x: 4, y: 0, width: 2, height: 2, elevation: 1 });
  const issues = validateWorld(document, []);
  assert.ok(issues.some(s => s.includes('bad-stair'))); assert.ok(issues.some(s => s.includes('sovrapposte')));
});
test('warps require their entry floor and retain reversed entry/arrival floors', () => {
  const document = newWorldDocument();
  const warp = { id: 'warp', name: 'Door', from: 'world', to: 'world', entry: { x: 0, y: 0 }, arrival: { x: 2, y: 0 }, activation: 'walk' as const, entryElevation: -1, arrivalElevation: 14 };
  document.warps = [warp]; setWarpReturn(document, warp, true, 'reverse');
  assert.equal(atWarp({ ...p(.5, .5), elevation: 0 }, warp), false);
  assert.equal(atWarp({ ...p(.5, .5), elevation: -1 }, warp), true);
  const reverse = parseWorldDocument(document).warps![1];
  assert.equal(reverse.entryElevation, 14); assert.equal(reverse.arrivalElevation, -1);
});
