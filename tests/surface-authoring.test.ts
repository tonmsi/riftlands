import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSurfacePoint, planBridge, removeBridge, syncGroundWarpElevations, upsertSurfaceLinks } from '../client/editors/surface-authoring';
import { planStair, validateSurfaceStairs, type StairData } from '../shared/surface-stairs';
import { BASE_SURFACE, ELEVATION_STEP, MAX_ELEVATION, validateSurfaceData, type SurfaceCell, type SurfaceLink } from '../shared/world-surfaces';
import { TILE_SIZE } from '../shared/config';
import type { Vec2 } from '../shared/types';
import { SurfaceStroke, type SurfacePaintSettings } from '../client/editors/world/elevation-editor';
import { newWorldDocument } from '../shared/world-schema';
import { World } from '../shared/world';

function cell(x: number, y: number, elevation = 0, surfaceId = BASE_SURFACE): SurfaceCell {
  return { x, y, elevation, surfaceId, kind: surfaceId === BASE_SURFACE ? 'ground' : 'bridge', material: 'grass', wallMaterial: 'earth' };
}
const lookupFor = (cells: readonly SurfaceCell[]) => (p: Vec2) => cells.find(c => c.x === p.x && c.y === p.y && c.surfaceId === (p.surfaceId ?? BASE_SURFACE));
const columnFor = (cells: readonly SurfaceCell[]) => (x: number, y: number) => cells.filter(c => c.x === x && c.y === y);
const settings = { material: 'wood', wallMaterial: 'wood' } as const;

test('surface picking chooses the visible upper top and can explicitly reveal the ground underneath', () => {
  const surfaces = [cell(3, 5), cell(3, 5, 1, 'deck')];
  assert.deepEqual(pickSurfacePoint(3.8, 5.1, columnFor(surfaces)), { x: 3, y: 5, surfaceId: 'deck', elevation: 1 });
  assert.deepEqual(pickSurfacePoint(3.8, 5.1, columnFor(surfaces), BASE_SURFACE), { x: 3, y: 5, surfaceId: BASE_SURFACE, elevation: 0 });
  assert.deepEqual(pickSurfacePoint(3.8, 5.9, columnFor(surfaces)), { x: 3, y: 5, surfaceId: BASE_SURFACE, elevation: 0 });
  assert.deepEqual(pickSurfacePoint(3.8, 5.1, columnFor(surfaces), 'missing'), { x: 3, y: 5, surfaceId: BASE_SURFACE, elevation: 0 });
});

test('surface picking finds the highest allowed elevation and handles negative tiles and top boundaries', () => {
  const high = cell(-2, 20, MAX_ELEVATION), top = high.y - MAX_ELEVATION * ELEVATION_STEP / TILE_SIZE;
  assert.deepEqual(pickSurfacePoint(-1.3, top + .8, columnFor([high])), { x: -2, y: 20, surfaceId: BASE_SURFACE, elevation: MAX_ELEVATION });
  assert.equal(pickSurfacePoint(-1.3, top, columnFor([high])).elevation, MAX_ELEVATION);
  assert.equal(pickSurfacePoint(-1.3, top + 1, columnFor([high])).elevation, 0, 'the next row does not pick the preceding top face');
  assert.deepEqual(pickSurfacePoint(-1.3, -2.2, () => []), { x: -2, y: -3, surfaceId: BASE_SURFACE, elevation: 0 });
});

test('picking follows rendering priority when different logical rows overlap', () => {
  const surfaces = [cell(1, 3, 1), cell(1, 4, 4), cell(1, 4, 4, 'deck')];
  assert.deepEqual(pickSurfacePoint(1.5, 2.8, columnFor(surfaces)), { x: 1, y: 4, surfaceId: 'deck', elevation: 4 });
});

test('bridge plans connect both banks, keep endpoints intact and preserve independent water underneath', () => {
  const terrain = [cell(0, 8, 3), cell(4, 8, 3), ...[1, 2, 3].map(x => ({ ...cell(x, 8), material: 'water' as const }))];
  const before = structuredClone(terrain);
  for (const c of terrain) Object.freeze(c);
  Object.freeze(terrain);
  const plan = planBridge({ x: 0, y: 8 }, { x: 4, y: 8 }, lookupFor(terrain), { ...settings, wallSkin: 'wall-legno' });
  assert.deepEqual(plan.cells.map(c => [c.x, c.y, c.elevation, c.kind]), [[1, 8, 3, 'bridge'], [2, 8, 3, 'bridge'], [3, 8, 3, 'bridge']]);
  assert.equal(new Set(plan.cells.map(c => c.surfaceId)).size, 1);
  assert.ok(plan.cells.every(c => c.wallSkin === 'wall-legno'));
  assert.deepEqual(plan.links.map(l => [l.from.x, l.to.x, l.kind]), [[0, 1, 'bridge-entry'], [3, 4, 'bridge-entry']]);
  assert.equal(plan.links[0].from.surfaceId, BASE_SURFACE);
  assert.equal(plan.links[1].to.surfaceId, BASE_SURFACE);
  assert.deepEqual(terrain, before);
  assert.doesNotThrow(() => validateSurfaceData([...terrain, ...plan.cells], plan.links));
});

test('bridge plans support vertical and reversed drags and stable preview IDs', () => {
  const terrain = [cell(-1, -4, 2), cell(-1, 0, 2)];
  const down = planBridge(terrain[0], terrain[1], lookupFor(terrain), settings);
  const up = planBridge(terrain[1], terrain[0], lookupFor(terrain), settings);
  assert.equal(down.cells[0].surfaceId, up.cells[0].surfaceId);
  assert.deepEqual(up.cells.map(c => c.y), [-1, -2, -3]);
  const preview = planBridge(terrain[0], terrain[1], lookupFor(terrain), { ...settings, id: 'preview-bridge' });
  assert.ok(preview.cells.every(c => c.surfaceId === 'preview-bridge'));
  assert.doesNotThrow(() => validateSurfaceData([...terrain, ...up.cells], up.links));
});

test('bridge endpoints can belong to an existing deck and minimum spans make one connected cell', () => {
  const terrain = [cell(1, 2, 2, 'existing-deck'), cell(3, 2, 2)];
  const plan = planBridge(terrain[0], terrain[1], lookupFor(terrain), settings);
  assert.equal(plan.cells.length, 1);
  assert.equal(plan.links[0].from.surfaceId, 'existing-deck');
  assert.equal(plan.links[0].to.x, plan.links[1].from.x);
  assert.doesNotThrow(() => validateSurfaceData([...terrain, ...plan.cells], plan.links));
});

test('the longest permitted bridge and surface identifier still produce valid bounded metadata', () => {
  const terrain = [cell(0, 0, 2), cell(96, 0, 2)];
  const plan = planBridge(terrain[0], terrain[1], lookupFor(terrain), { ...settings, id: 'b'.repeat(128) });
  assert.equal(plan.cells.length, 95);
  assert.doesNotThrow(() => validateSurfaceData([...terrain, ...plan.cells], plan.links));
});

test('bridge plans reject missing, water and blocked banks and uneven elevations', () => {
  const from = cell(0, 0, 2), to = cell(3, 0, 2);
  for (const target of [undefined, { ...to, material: 'water' as const }, { ...to, blocked: true }]) {
    assert.throws(() => planBridge(from, to, lookupFor(target ? [from, target] : [from]), settings), /sponde percorribili/);
  }
  assert.throws(() => planBridge(from, to, lookupFor([from, { ...to, elevation: 1 }]), settings), /stessa quota/);
});

test('bridge plans reject diagonal, adjacent and unbounded drags before reading the map', () => {
  const noLookup = () => { throw new Error('unexpected map lookup'); };
  assert.throws(() => planBridge({ x: 0, y: 0 }, { x: 2, y: 2 }, noLookup, settings), /orizzontale o in verticale/);
  assert.throws(() => planBridge({ x: 0, y: 0 }, { x: 1, y: 0 }, noLookup, settings), /almeno una cella/);
  assert.throws(() => planBridge({ x: 0, y: 0 }, { x: 97, y: 0 }, noLookup, settings), /massimo 96/);
});

test('bridges require ground clearance and allow equal-height water even when its lower plane is blocked', () => {
  const from = cell(0, 0, 2), to = cell(3, 0, 2);
  for (const elevation of [2, 4]) assert.throws(() => planBridge(from, to, lookupFor([from, to, cell(1, 0, elevation)]), settings), /attraversa terreno/);
  assert.doesNotThrow(() => planBridge(from, to, lookupFor([from, to, cell(1, 0, 1)]), settings));
  const flat = [cell(0, 0), cell(2, 0), { ...cell(1, 0), material: 'water' as const, blocked: true }];
  assert.equal(planBridge(flat[0], flat[1], lookupFor(flat), settings).cells[0].elevation, 0);
  assert.throws(() => planBridge(flat[0], flat[1], lookupFor([flat[0], flat[1], cell(1, 0)]), settings), /Alza le due sponde/);
  assert.throws(() => planBridge(flat[0], flat[1], lookupFor([flat[0], flat[1], { ...flat[2], elevation: 1 }]), settings), /Alza le due sponde/);
});

test('new accesses replace reversed edges without removing independent surfaces at the same coordinates', () => {
  const old: SurfaceLink = { id: 'old', kind: 'stairs', from: { x: 0, y: 0, surfaceId: BASE_SURFACE }, to: { x: 1, y: 0, surfaceId: BASE_SURFACE } };
  const upper: SurfaceLink = { ...old, id: 'upper', from: { ...old.from, surfaceId: 'deck' }, to: { ...old.to, surfaceId: 'deck' } };
  const replacement: SurfaceLink = { id: 'new', kind: 'ramp', from: old.to, to: old.from };
  const data = { surfaceLinks: [old, upper] };
  upsertSurfaceLinks(data, [replacement, replacement]);
  assert.deepEqual(data.surfaceLinks, [replacement, upper]);
  const empty: { surfaceLinks?: SurfaceLink[] } = {};
  upsertSurfaceLinks(empty, [old]);
  assert.deepEqual(empty.surfaceLinks, [old]);
});

const paintSettings: SurfacePaintSettings = { elevation: 8, material: 'grass', wallMaterial: 'rock', surfaceId: BASE_SURFACE, blocked: false };

test('PNG wall kits persist on relative height changes and explicit default painting removes the skin', () => {
  const document = newWorldDocument(), stroke = new SurfaceStroke(document);
  stroke.paint({ x: 2, y: 3 }, 'height', { ...paintSettings, wallSkin: 'wall-roccia' });
  assert.equal(document.surfaceCells![0].wallSkin, 'wall-roccia');
  stroke.paint({ x: 2, y: 3 }, 'raise-height', { ...paintSettings, wallMaterial: 'brick', wallSkin: 'wall-mattoni' });
  assert.equal(document.surfaceCells![0].elevation, 9);
  assert.equal(document.surfaceCells![0].wallMaterial, 'rock');
  assert.equal(document.surfaceCells![0].wallSkin, 'wall-roccia');
  stroke.paintMaterial({ x: 2, y: 3 }, 'sand');
  assert.equal(document.surfaceCells![0].wallSkin, 'wall-roccia');
  stroke.paint({ x: 2, y: 3 }, 'height', paintSettings);
  assert.equal('wallSkin' in document.surfaceCells![0], false);
  stroke.paint({ x: 4, y: 3 }, 'raise-height', { ...paintSettings, wallSkin: 'wall-roccia' });
  assert.equal(document.surfaceCells![1].wallSkin, 'wall-roccia');
});

test('new stair supports inherit the landing PNG kit unless the author explicitly chooses default artwork', () => {
  const from = { ...cell(0, 0), wallSkin: 'wall-roccia' }, to = cell(3, 0, 3), terrain = [from, to];
  const lookup = (x: number, y: number, surfaceId: string) => lookupFor(terrain)({ x, y, surfaceId });
  const inherited = planStair(from, to, lookup, { id: 'inherited' });
  assert.ok(inherited.cells.every(c => c.wallSkin === 'wall-roccia'));
  const standard = planStair(from, to, lookup, { id: 'standard', wallSkin: undefined });
  assert.ok(standard.cells.every(c => !('wallSkin' in c)));
});

test('relative world elevation preserves authored materials and explicit water walkability', () => {
  const document = newWorldDocument();
  document.surfaceCells = [{ ...cell(2, 3, 4), material: 'water', wallMaterial: 'brick', blocked: false }];
  const stroke = new SurfaceStroke(document);
  stroke.paint({ x: 2, y: 3 }, 'raise-height', paintSettings);
  assert.deepEqual(document.surfaceCells[0], { ...cell(2, 3, 5), material: 'water', wallMaterial: 'brick', blocked: false });
  assert.equal(new World(document.seed, 16, 'world', document, []).surfaceAt(2, 3)!.blocked, false);
  stroke.paint({ x: 2, y: 3 }, 'lower-height', paintSettings);
  assert.deepEqual(document.surfaceCells[0], { ...cell(2, 3, 4), material: 'water', wallMaterial: 'brick', blocked: false });
});

test('ground sculpting updates anchored objects, NPCs and spawn while preserving the independent deck', () => {
  const document = newWorldDocument();
  const ground = { ...cell(2, 3, 4), material: 'sand' as const, wallMaterial: 'earth' as const }, deck = cell(2, 3, 9, 'deck');
  document.surfaceCells = [ground, deck];
  document.placements = [{ id: 'ground-object', assetId: 'asset', x: 2, y: 3, elevation: 4 }, { id: 'deck-object', assetId: 'asset', x: 2, y: 3, surfaceId: 'deck', elevation: 9 }];
  document.npcs = [{ id: 'npc', npcKind: 'slime', x: 2, y: 3, level: 1, surfaceId: BASE_SURFACE, elevation: 4 }];
  document.spawn = { x: 2, y: 3, elevation: 4 };
  const stroke = new SurfaceStroke(document);
  stroke.paint({ x: 2, y: 3 }, 'raise-height', paintSettings);
  assert.equal(document.placements[0].elevation, 5);
  assert.equal(document.npcs[0].elevation, 5);
  assert.equal(document.spawn.elevation, 5);
  assert.equal(document.placements[1].elevation, 9);
  assert.deepEqual(document.surfaceCells.find(c => c.surfaceId === 'deck'), deck);
  assert.equal(document.surfaceCells.find(c => c.surfaceId === BASE_SURFACE)!.material, 'sand');
  stroke.paint({ x: 2, y: 3 }, 'clear-height', paintSettings);
  assert.equal(document.placements[0].elevation, undefined);
  assert.equal(document.npcs[0].elevation, undefined);
  assert.equal(document.spawn.elevation, undefined);
  assert.equal(document.placements[1].elevation, 9);
  assert.deepEqual(document.surfaceCells, [deck]);
});

test('relative brushes clamp elevations and bridge erasure keeps the underlying terrain and unrelated connectors', () => {
  const document = newWorldDocument();
  document.surfaceCells = [cell(0, 0, 16), cell(1, 0), cell(0, 0, 16, 'deck')];
  document.surfaceLinks = [
    { id: 'ground-access', kind: 'stairs', from: { x: 0, y: 0, surfaceId: BASE_SURFACE }, to: { x: 1, y: 0, surfaceId: BASE_SURFACE } },
    { id: 'deck-access', kind: 'bridge-entry', from: { x: 1, y: 0, surfaceId: BASE_SURFACE }, to: { x: 0, y: 0, surfaceId: 'deck' } },
  ];
  const groundAccess = structuredClone(document.surfaceLinks[0]), stroke = new SurfaceStroke(document);
  stroke.paint({ x: 0, y: 0 }, 'raise-height', paintSettings);
  stroke.paint({ x: 1, y: 0 }, 'lower-height', paintSettings);
  assert.equal(document.surfaceCells.find(c => c.surfaceId === BASE_SURFACE && c.x === 0)!.elevation, 16);
  assert.equal(document.surfaceCells.find(c => c.surfaceId === BASE_SURFACE && c.x === 1)!.elevation, 0);
  stroke.paint({ x: 0, y: 0, surfaceId: 'deck' }, 'clear-bridge', paintSettings);
  assert.equal(document.surfaceCells.some(c => c.surfaceId === 'deck'), false);
  assert.equal(document.surfaceCells.find(c => c.x === 0)!.elevation, 16);
  assert.deepEqual(document.surfaceLinks, [groundAccess]);
});

test('ground warp synchronization follows the active map, updates reverse doors and keys, and leaves deck endpoints intact', () => {
  const document = newWorldDocument();
  document.warps = [
    { id: 'outbound', name: 'Porta', from: 'world', to: 'cave', activation: 'walk', reverseId: 'inbound',
      entry: { x: 1, y: 1, elevation: 2 }, arrival: { x: 4, y: 4, elevation: 8 },
      keyGate: { id: 'key', mapId: 'world', position: { x: 3, y: 3, elevation: 2 } } },
    { id: 'inbound', name: 'Ritorno', from: 'cave', to: 'world', activation: 'walk', reverseId: 'outbound',
      entry: { x: 4, y: 4, elevation: 8 }, arrival: { x: 1, y: 1, elevation: 2 },
      keyGate: { id: 'key', mapId: 'world', position: { x: 3, y: 3, elevation: 2 } } },
    { id: 'deck-door', name: 'Passaggio', from: 'world', to: 'world', activation: 'walk',
      entry: { x: 1, y: 1, surfaceId: 'deck', elevation: 9 }, arrival: { x: 2, y: 2, surfaceId: BASE_SURFACE, elevation: 4 },
      keyGate: { id: 'other-key', mapId: 'cave', position: { x: 3, y: 3, elevation: 8 } } },
  ];
  const before = structuredClone(document.warps), terrain = [cell(1, 1, 5), cell(2, 2), cell(3, 3)];
  syncGroundWarpElevations(document, 'world', lookupFor(terrain));
  assert.equal(document.warps[0].entry.elevation, 5);
  assert.equal(document.warps[1].arrival.elevation, 5);
  assert.deepEqual(document.warps[0].arrival, before[0].arrival);
  assert.deepEqual(document.warps[1].entry, before[1].entry);
  assert.equal(document.warps[0].keyGate!.position.elevation, undefined);
  assert.equal(document.warps[1].keyGate!.position.elevation, undefined);
  assert.deepEqual(document.warps[2].entry, before[2].entry);
  assert.deepEqual(document.warps[2].arrival, { x: 2, y: 2, surfaceId: BASE_SURFACE });
  assert.deepEqual(document.warps[2].keyGate, before[2].keyGate);
});

test('whole bridge erasure removes dependent stairs and content while preserving the lower and unrelated planes', () => {
  const ground = [cell(0, 5), cell(3, 5), cell(4, 5), cell(5, 5, 3)], deck = [cell(3, 5, 3, 'deck'), cell(4, 5, 3, 'deck')];
  const other = cell(8, 5, 3, 'other-deck'), cells = [...ground, ...deck, other];
  const stair = planStair(ground[0], deck[0], (x, y, id) => cells.find(c => c.x === x && c.y === y && c.surfaceId === id), { id: 'deck-stair' });
  const entry: SurfaceLink = { id: 'deck-entry', kind: 'bridge-entry', from: deck[1], to: ground[3] };
  const unrelated: SurfaceLink = { id: 'other-entry', kind: 'bridge-entry', from: other, to: cell(9, 5, 3) };
  cells.push(unrelated.to as SurfaceCell);
  const content = [{ surfaceId: 'deck' }, { surfaceId: 'stair:deck-stair' }, { surfaceId: BASE_SURFACE }, { surfaceId: 'other-deck' }];
  for (const spawn of [deck[0], stair.cells[0]]) {
    const data: StairData = { surfaceCells: structuredClone([...cells, ...stair.cells]), surfaceLinks: [...stair.links, entry, unrelated],
      surfaceStairs: [stair.stair], placements: structuredClone(content), npcs: structuredClone(content),
      assetPlacements: structuredClone(content), entities: structuredClone(content), spawn: { ...spawn } };
    assert.equal(removeBridge(data, 'deck'), true);
    assert.deepEqual(data.surfaceCells, [...ground, other, unrelated.to]);
    assert.deepEqual(data.surfaceLinks, [unrelated]); assert.deepEqual(data.surfaceStairs, []);
    for (const key of ['placements', 'npcs', 'assetPlacements', 'entities'] as const) assert.deepEqual(data[key], content.slice(2));
    assert.equal(data.spawn!.surfaceId, BASE_SURFACE);
    assert.ok(ground.some(c => c.x === data.spawn!.x && c.y === data.spawn!.y && c.elevation === data.spawn!.elevation));
    assert.doesNotThrow(() => validateSurfaceData(data.surfaceCells, data.surfaceLinks));
    assert.doesNotThrow(() => validateSurfaceStairs(data.surfaceCells!, data.surfaceLinks!, data.surfaceStairs));
    assert.equal(removeBridge(data, 'deck'), false); assert.equal(removeBridge(data, BASE_SURFACE), false);
  }
});
