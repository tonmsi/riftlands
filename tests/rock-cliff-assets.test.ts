import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import runtimeManifest from '../client/render/rock-cliff-manifest.json';

test('the reusable cliff pack matches runtime metadata and every region fits its real PNG', () => {
  const pack = JSON.parse(readFileSync('public/terrain-textures/rock-cliffs-v1/manifest.json', 'utf8'));
  assert.deepEqual(pack, runtimeManifest, 'asset pack and bundled runtime must describe the same pieces');
  for (const group of [pack.front, pack.weathered, pack.steps]) {
    const data = readFileSync(resolve('public', group.image.slice(1)));
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
    for (const [name, rect] of Object.entries(group)) {
      if (!rect || typeof rect !== 'object') continue;
      const r = rect as { x: number; y: number; width: number; height: number };
      assert.ok([r.x, r.y, r.width, r.height].every(Number.isInteger), `${name}: integer source coordinates`);
      assert.ok(r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= width && r.y + r.height <= height, `${name}: region remains inside ${group.image}`);
    }
  }
});
