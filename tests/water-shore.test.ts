import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedShore, shoreCurve, shorePoint, type ShoreTile } from '../client/render/water-shore';

function waterTiles(points: readonly [number, number][]): ShoreTile[] {
  const water = new Set(points.map(([x,y]) => `${x},${y}`));
  const neighbors = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];
  return points.map(([x,y]) => ({ x, y, variation: ((x * 31 + y * 17) % 11) / 10,
    mask: neighbors.reduce((mask,[dx,dy],i) => mask | (water.has(`${x+dx},${y+dy}`) ? 0 : 1 << i),0) }));
}
const key = (p: [number, number]) => p.map(v => Math.round(v * 1000)).join(',');

test('connected river contour has no gaps and matching tangents at every tile joint', () => {
  const points: [number,number][] = [];
  for (let y = 0; y < 20; y++) for (let x = 0; x < 5; x++) points.push([x + Math.round(Math.sin(y*.5)*2),y]);
  const segments = connectedShore(waterTiles(points));
  const starts = new Map(segments.map(s => [key(s.curve.start),s.curve]));
  assert.equal(starts.size,segments.length);
  for (const {curve} of segments) {
    const next = starts.get(key(curve.end)); assert.ok(next, 'every shore end connects to another start');
    assert.deepEqual(curve.end,next.start);
    for (const axis of [0,1]) assert.ok(Math.abs((curve.end[axis]-curve.c2[axis])-(next.c1[axis]-next.start[axis])) < 1e-8,
      'the shared knot has the same tangent on both sides');
  }
});

test('connected shoreline preserves tiny pools and separate diagonal water cells', () => {
  for (let pattern = 1; pattern < 16; pattern++) {
    const points = [[0,0],[1,0],[0,1],[1,1]].filter((_,i) => pattern & 1 << i) as [number,number][];
    const segments = connectedShore(waterTiles(points)), starts = new Set(segments.map(s => key(s.curve.start)));
    for (const s of segments) {
      assert.ok(starts.has(key(s.curve.end)));
      assert.ok(Math.hypot(s.curve.end[0]-s.curve.start[0],s.curve.end[1]-s.curve.start[1]) > 3);
    }
  }
});

test('three-tile halo produces the same shore in a partial redraw as in a complete map', () => {
  const points: [number,number][] = [];
  for (let y=-15;y<=15;y++) for(let x=-3;x<=3;x++) points.push([x+Math.round(Math.sin(y*.4)*2),y]);
  const tiles=waterTiles(points), full=connectedShore(tiles), partial=connectedShore(tiles.filter(t => t.y>=-5 && t.y<=5));
  const expected=new Map(full.map(s=>[`${s.x},${s.y},${s.corner}`,s.curve]));
  for(const s of partial.filter(s=>s.y>=-2 && s.y<=2)) assert.deepEqual(s.curve,expected.get(`${s.x},${s.y},${s.corner}`));
});

test('adjacent shore pieces retain identical edge endpoints across visual variations', () => {
  const first = shoreCurve(1, 0, 0)!, other = shoreCurve(1, 0, 1)!;
  assert.deepEqual(first.start, other.start); assert.deepEqual(first.end, other.end);
  for (let variation = 0; variation <= 1; variation += .2) {
    const rotated = shorePoint(shoreCurve(1, 1, variation)!, 1, 1);
    assert.ok(Math.abs(rotated.x - 48) < 1e-8 && Math.abs(rotated.y - first.start[1]) < 1e-8);
  }
});

test('water objects follow a finite shore normal directed into the water for every mask', () => {
  for(let mask=0;mask<256;mask++) for(let corner=0;corner<4;corner++) {
    const curve=shoreCurve(mask,corner,.5); if(!curve) continue;
    for(const t of [.2,.5,.8]) {
      const p=shorePoint(curve,t,corner);
      assert.ok([p.x,p.y,p.nx,p.ny].every(Number.isFinite));
      assert.ok(p.x>=0 && p.x<=48 && p.y>=0 && p.y<=48);
      assert.ok(Math.abs(Math.hypot(p.nx,p.ny)-1)<1e-8);
      assert.ok(p.nx*(24-p.x)+p.ny*(24-p.y)>=-1e-8);
    }
  }
});

test('a rounded diagonal bank meets the straight shore without disconnected hooks', () => {
  const curve=shoreCurve(128,0,.5)!;
  assert.equal(curve.start[1],shoreCurve(1,0,.5)!.start[1]);
  assert.equal(curve.end[0],shoreCurve(8,0,.5)!.end[0]);
  assert.ok(shorePoint(curve,.5,0).x>0 && shorePoint(curve,.5,0).y>0);
});
