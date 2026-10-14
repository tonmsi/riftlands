import test from 'node:test';
import assert from 'node:assert/strict';
import { grassDetailDensity, grassPlantPlacements } from '../client/render/terrain-distribution';
import { SurfaceTerrain } from '../client/render/surface-terrain';
import type { World } from '../shared/world';

test('grass density is sparse, spatially varied and continuous across negative patch boundaries', () => {
  const values: number[] = [];
  for (let y = -60; y < 60; y++) for (let x = -60; x < 60; x++) {
    const p = grassDetailDensity(x, y); values.push(p);
    assert.ok(p >= .025 && p <= .145);
    assert.equal(p, grassDetailDensity(x, y));
    assert.ok(Math.abs(p - grassDetailDensity(x + 1, y)) < .04);
  }
  assert.ok(Math.max(...values) - Math.min(...values) > .08);
  assert.ok(values.reduce((a, b) => a + b, 0) / values.length < .075);
});

test('grass plants form sparse deterministic groups and their sprites fit inside grass cells',()=>{
  let plants=0,occupied=0,groups=0;
  for(let y=-60;y<60;y++)for(let x=-60;x<60;x++) {
    const cluster=grassPlantPlacements(x,y);assert.deepEqual(cluster,grassPlantPlacements(x,y));
    plants+=cluster.length;if(cluster.length)occupied++;if(cluster.length>1)groups++;
    assert.ok(cluster.length<=3);
    for(const plant of cluster) {
      assert.ok(plant.x-14*plant.scale>=0 && plant.x+14*plant.scale<=48);
      assert.ok(plant.y-20*plant.scale>=0 && plant.y+4*plant.scale<=48);
      assert.ok(plant.variant>=0 && plant.variant<12);
    }
  }
  assert.ok(plants/14400>.065 && plants/14400<.09,'the grass remains sparse after the small density increase');
  assert.ok(groups/occupied>.06 && groups/occupied<.15,'only occasional plants form small clusters');
  assert.ok(plants>occupied*1.10 && plants<occupied*1.20);
});

test('ice and snow contacts suppress water plants independently of climate and orientation', () => {
  const terrain = new SurfaceTerrain({} as never, {} as never);
  for (const material of ['ice', 'snow'] as const) for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1]]) for (const temperature of [.2, .8]) {
    const world = { surfaceIndex: { at: () => undefined }, getTile: (x: number, y: number) => x === dx && y === dy ? material : 'water', getMoisture: () => .5, getTemperature: () => temperature } as unknown as World;
    assert.equal(terrain.waterPlantsMask(world, 0, 0, 255), 0);
    const edges = terrain.waterEdges(world, 0, 0);
    if (dx === 1 && dy === -1) assert.equal(edges.banks[1].highlight, '#edf7fa', 'diagonal ice uses a frozen palette, not sand');
    // With only frozen neighbors, the bank pass must not draw a land ribbon or plants.
    terrain.drawNaturalWaterBanks({} as never, world, 0, 0, 0, 0);
  }
  const land = { surfaceIndex: { at: () => undefined }, getTile: () => 'grass' } as unknown as World;
  assert.equal(terrain.waterPlantsMask(land, 0, 0, 255), 255);
});
