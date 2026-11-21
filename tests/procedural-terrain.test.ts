import test from 'node:test';
import assert from 'node:assert/strict';
import { proceduralTerrainAt, paintProceduralTerrain } from '../shared/procedural-terrain';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { WorldBrush, forkWorldDocument } from '../shared/world-editing';
import { TerrainElevationBrush } from '../shared/terrain-elevation-editing';
import { World } from '../shared/world';

test('procedural terrain uses all six integer levels, never exceeds 4 and joins adjacent cells', () => {
  const levels = new Set<number>();
  for (let y = -240; y <= 240; y++) for (let x = -240; x <= 240; x++) {
    const sample = proceduralTerrainAt(x,y,734291,.5,.5);
    levels.add(sample.elevation);
    assert.ok(Number.isInteger(sample.elevation) && sample.elevation >= -1 && sample.elevation <= 4);
    assert.ok(Math.abs(sample.elevation-proceduralTerrainAt(x+1,y,734291,.5,.5).elevation)<=1);
    assert.equal(sample.terrain === 'water',sample.elevation === -1);
  }
  assert.deepEqual([...levels].sort((a,b)=>a-b),[-1,0,1,2,3,4]);
  assert.notDeepEqual(proceduralTerrainAt(0,0,1,.5,.5),proceduralTerrainAt(0,0,2,.5,.5));
});

test('procedural brush persists real heights and mass locally, supports repaint and leaves undo snapshot untouched', () => {
  const before = newWorldDocument(); before.baseTerrain='water';
  const document = forkWorldDocument(before);
  const tiles = new WorldBrush(document), heights = new TerrainElevationBrush(document);
  const points = new Map<number,{x:number;y:number}>();
  for(let y=-240;y<=240 && points.size<6;y+=4) for(let x=-240;x<=240;x+=4) {
    const e=proceduralTerrainAt(x,y,734291,.5,.5).elevation;
    if(!points.has(e))points.set(e,{x,y});
  }
  assert.equal(points.size,6);
  for(const point of points.values()) {
    paintProceduralTerrain(point,734291,.5,.5,tiles,heights);
    paintProceduralTerrain(point,734291,.5,.5,tiles,heights);
  }
  tiles.flushTiles(); heights.flush(true);
  const exported = parseWorldDocument(JSON.parse(JSON.stringify(document)));
  const world = new World(734291,160,'world',exported,[]);
  for(const [e,p] of points) {
    assert.equal(world.elevation.terrainElevationAt(p.x+.5,p.y+.5),e);
    assert.equal(world.getTile(p.x,p.y),e===-1?'water':'grass');
    if(e>=0)assert.ok(exported.geometry!.solids.some(s=>s.x===p.x&&s.y===p.y&&s.base===-1&&s.top===e));
  }
  assert.equal(world.getTile(10000,10000),'water');
  assert.equal(world.elevation.terrainElevationAt(10000.5,10000.5),-1);
  assert.deepEqual(before.tiles,[]); assert.equal(before.geometry,undefined);
});
