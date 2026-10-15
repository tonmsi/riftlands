import test from 'node:test';
import assert from 'node:assert/strict';
import { SurfaceTerrain } from '../client/render/surface-terrain';
import { authoredRockStairGeometry } from '../client/render/rock-cliff-geometry';
import { RockCliffArt } from '../client/render/rock-cliff-art';
import { WallSpriteArt } from '../client/render/wall-sprite-art';
import rockAtlas from '../client/render/rock-cliff-manifest.json';
import type { WallSpriteKit } from '../shared/wall-sprite-kits';
import type { ContourPoint } from '../client/render/surface-contours';
import type { TerrainMaterials } from '../client/render/terrain-materials';
import type { EnvironmentArt } from '../client/render/environment-art';
import { planStair, removeStair, stairGeometry } from '../shared/surface-stairs';
import { SurfaceIndex, type SurfaceCell, type SurfaceStair } from '../shared/world-surfaces';
import { newWorldDocument } from '../shared/world-schema';
import type { World } from '../shared/world';

function recordingContext() {
  const fills: number[][] = [], holes: ContourPoint[][] = [];
  let points: ContourPoint[] = [];
  const methods: Record<string, unknown> = {
    beginPath() { points = []; },
    moveTo(x: number, y: number) { points.push({ x, y }); },
    lineTo(x: number, y: number) { points.push({ x, y }); },
    clip(rule?: string) { if (rule === 'evenodd') holes.push(points.slice()); },
    fillRect(...rectangle: number[]) { fills.push(rectangle); },
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  const ctx = new Proxy(methods, { get(target, property) { return target[property as string] ?? (() => {}); } }) as unknown as CanvasRenderingContext2D;
  return { ctx, fills, holes };
}

test('inset stairs preserve cardinal steps and open a continuous shaft without a second stone body', () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const levels of [1, 2, 4]) for (const width of [48, 96, 144]) {
    const stair: SurfaceStair = { id: 'inset', kind: 'stairs', profile: 'terraced', width,
      from: { x: 0, y: 0, elevation: 0, surfaceId: 'ground' },
      to: { x: dx * (levels + 1), y: dy * (levels + 1), elevation: levels, surfaceId: 'ground' } };
    const logical = stairGeometry(stair), art = authoredRockStairGeometry(stair);
    assert.deepEqual(art.sideFace, [], 'the existing wall supplies the staircase body');
    assert.deepEqual(art.landing, [], 'upper grass remains the landing instead of receiving another slab');
    assert.deepEqual(art.shoulders, [], 'the inset flight has no decorations outside its useful width');
    assert.equal(logical.inclinedRun, levels * 48);
    for (const [index, step] of art.treads.entries()) {
      assert.equal(Math.hypot(step.top[0].x - step.top[1].x, step.top[0].y - step.top[1].y), width);
      if (!index) continue;
      const previous = art.treads[index - 1];
      assert.ok(Math.hypot(previous.top[2].x - step.riser[1].x, previous.top[2].y - step.riser[1].y) < 1e-7);
      if (dx) assert.ok((step.center.x - previous.center.x) * dx > 0);
      else assert.ok((step.center.y - previous.center.y) * dy > 0);
    }
  }
});

test('north wall bands foreshorten their texture without changing their tile or the directional PNG kit', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalMatrix = Object.getOwnPropertyDescriptor(globalThis, 'DOMMatrix');
  class Matrix {
    a = 1; d = 1; e = 0; f = 0;
    translate(x: number, y: number) { this.e += x; this.f += y; return this; }
    scale(x: number, y: number) { this.a *= x; this.d *= y; return this; }
  }
  const raster = () => {
    const canvas = { width: 0, height: 0, getContext() {
      return new Proxy({ getImageData() { return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }; } },
        { get(target, name) { return target[name as keyof typeof target] ?? (() => {}); } });
    } };
    return canvas;
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: raster } });
  Object.defineProperty(globalThis, 'DOMMatrix', { configurable: true, value: Matrix });
  try {
    const probe = () => {
      const recording = recordingContext(), scales: number[] = [], images: HTMLImageElement[] = [];
      recording.ctx.createPattern = () => ({ setTransform(matrix: Matrix) { scales.push(matrix.d); } }) as unknown as CanvasPattern;
      recording.ctx.drawImage = image => { images.push(image as HTMLImageElement); };
      return { ...recording, scales, images };
    };
    const band: SurfaceCell = { x: 0, y: 0, elevation: 2, surfaceId: 'ground', kind: 'ground',
      layout: 'terraced', material: 'grass', wallMaterial: 'rock', wallSkin: 'probe' };
    const fakeImage = (src: string) => ({ src, width: 48, height: 16 }) as HTMLImageElement;
    const rock = new RockCliffArt();
    (rock as unknown as { images: Map<string, HTMLImageElement> }).images.set(rockAtlas.front.image, fakeImage(rockAtlas.front.image));
    const north = probe(), south = probe();
    rock.paintBand(north.ctx, band, 0, 0, undefined, 4, 1);
    rock.paintBand(south.ctx, band, 0, 0, undefined, 1, 4);
    assert.ok(north.scales[0] > 0 && north.scales[0] < south.scales[0], 'the back uses shorter rock forms than the front');
    assert.equal(north.scales.length, 1, 'the back does not reuse frontal cap and toe textures');
    assert.equal(south.scales[0], 1, 'the south face keeps its vertical texture');
    for (const view of [north, south]) assert.ok(view.fills.every(rect => rect[2] === 48 && rect[3] === 48));
    for (const lowerMask of [1 | 2, 1 | 8]) {
      const corner = probe(); rock.paintBand(corner.ctx, band, 0, 0, undefined, 0, lowerMask);
      assert.ok(corner.fills.every(rect => rect[2] === 48 && rect[3] === 48), 'corner lighting never opens a gap in its tile');
    }
    const wall = new WallSpriteArt(), body = fakeImage('/body.png'), back = fakeImage('/back.png');
    const kit: WallSpriteKit = { id: 'probe', name: 'Probe', material: 'rock', tileSize: 48, levelHeight: 16,
      pixelated: false, parts: { body: { image: body.src, width: 48, height: 16 } } };
    const loaded = wall as unknown as { kits: Map<string, WallSpriteKit>; images: Map<string, HTMLImageElement> };
    loaded.kits.set(kit.id, kit); loaded.images.set(body.src, body); loaded.images.set(back.src, back);
    const generic = probe(); wall.paintBand(generic.ctx, band, 0, 0, 1);
    assert.equal(generic.scales[0], north.scales[0], 'a generic PNG body preserves the back perspective');
    kit.layout = 'grid-3x3'; kit.parts.back = { image: back.src, width: 48, height: 16 };
    const grid = probe(); wall.paintBand(grid.ctx, band, 0, 0, 1);
    assert.equal(grid.scales[0], 1, 'a directional grid keeps its source perspective');
    assert.ok(grid.images.includes(back), 'the native back module is used');
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (originalMatrix) Object.defineProperty(globalThis, 'DOMMatrix', originalMatrix); else Reflect.deleteProperty(globalThis, 'DOMMatrix');
  }
});

test('inset art stops at the upper ground boundary while the logical landing and ordinary stairs stay intact', () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const levels of [1, 3, 4]) {
    const stair: SurfaceStair = { id: 'inset', kind: 'stairs', profile: 'terraced', width: 48,
      from: { x: 2, y: 3, elevation: 1, surfaceId: 'ground' },
      to: { x: 2 + dx * (levels + 1), y: 3 + dy * (levels + 1), elevation: 1 + levels, surfaceId: 'ground' } };
    const logical = stairGeometry(stair), end = 1 - logical.landing / logical.run;
    const flat = authoredRockStairGeometry(stair, false), projected = authoredRockStairGeometry(stair);
    for (const point of [...flat.corridor, ...flat.treads.flatMap(step => [...step.top, ...step.riser])])
      assert.ok(logical.progressAt(point) <= end + 1e-8, 'stone stays before the upper ground tile');
    assert.ok(flat.corridor.some(point => Math.abs(logical.progressAt(point) - end) < 1e-8));
    const border = logical.pointAt(end), lastTread = projected.treads.at(-1)!;
    assert.equal((lastTread.top[2].x + lastTread.top[3].x) / 2, border.x);
    assert.equal((lastTread.top[2].y + lastTread.top[3].y) / 2, border.y - logical.high.elevation * 16);
    assert.equal(logical.elevationAt(1), logical.high.elevation);
    assert.ok(logical.contains(logical.pointAt(1)), 'the real upper endpoint remains traversable');
    assert.doesNotThrow(() => new RockCliffArt().drawAuthoredStairs(recordingContext().ctx, stair));
    const ordinary = authoredRockStairGeometry({ ...stair, profile: 'landings' }, false);
    assert.equal(ordinary.landing.length, 4);
    assert.ok(ordinary.shoulders.length > 0);
    assert.ok(ordinary.corridor.some(point => Math.abs(logical.progressAt(point) - 1) < 1e-8),
      'ordinary stairs preserve their upper stone landing');
  }
});

test('wall cells paint a full rock tile and every crossed band restores its face after stair removal', () => {
  const doc = newWorldDocument();
  doc.surfaceCells = [];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) doc.surfaceCells.push({
    x, y, elevation: 2, layout: 'terraced', surfaceId: 'ground', kind: 'ground', material: 'grass', wallMaterial: 'rock',
  });
  const before = new SurfaceIndex(doc.surfaceCells);
  const lookup = (x: number, y: number, surfaceId: string): SurfaceCell | undefined => before.at(x, y, surfaceId)
    ?? (surfaceId === 'ground' ? { x, y, elevation: 0, surfaceId, kind: 'ground', material: 'grass', wallMaterial: 'rock' } : undefined);
  const plan = planStair({ x: -1, y: 4, surfaceId: 'ground' }, { x: 2, y: 4, surfaceId: 'ground' }, lookup,
    { id: 'inset', profile: 'terraced', cells: doc.surfaceCells });
  doc.surfaceCells.push(...plan.cells); doc.surfaceLinks = plan.links; doc.surfaceStairs = [plan.stair];
  const state = { authoring: { document: doc }, dungeons: [], surfaceIndex: new SurfaceIndex(doc.surfaceCells, doc.surfaceLinks, doc.surfaceStairs),
    authoringRevision: 0, getTile() { return 'grass'; }, getMoisture() { return .4; }, getTemperature() { return .6; } };
  const world = state as unknown as World, paintedMaterials: string[] = [];
  const painter = new SurfaceTerrain({ fill(_ctx: unknown, material: string) { paintedMaterials.push(material); return '#657184'; } } as unknown as TerrainMaterials,
    {} as EnvironmentArt);
  const shaft = authoredRockStairGeometry(plan.stair).corridor;
  for (const x of [0, 1]) {
    const band = state.surfaceIndex.at(x, 4)!;
    assert.equal(band.terrainRole, 'wall');
    const recording = recordingContext();
    painter.drawGroundLevel(recording.ctx, world, { elevation: band.elevation, cells: [band] });
    assert.ok(recording.fills.some(rect => rect[2] === 48 && rect[3] === 48), 'rock occupies the entire grid tile');
    assert.ok(recording.holes.some(hole => JSON.stringify(hole) === JSON.stringify(shaft)), 'each wall band cuts the same projected shaft');
  }
  assert.ok(paintedMaterials.length > 0); assert.ok(paintedMaterials.every(material => material === 'rock'), 'a band never paints its authored grass as a top');
  removeStair(doc, 'inset');
  state.surfaceIndex = new SurfaceIndex(doc.surfaceCells, doc.surfaceLinks, doc.surfaceStairs); state.authoringRevision++;
  for (const x of [0, 1]) {
    const band = state.surfaceIndex.at(x, 4)!, recording = recordingContext();
    painter.drawGroundLevel(recording.ctx, world, { elevation: band.elevation, cells: [band] });
    assert.deepEqual(recording.holes, [], 'removing the descriptor restores every rock face');
  }
});
