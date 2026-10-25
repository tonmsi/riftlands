import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorldDocument, parseWorldDocument, type WorldZone } from '../shared/world-schema';
import { WorldAuthoring, zoneClimateWeight, climateCurveWeight, climateBandState } from '../shared/world-authoring';
import { World } from '../shared/world';
import type { ClimateBand } from '../shared/world-schema';
import { TILE_SIZE } from '../shared/config';
import { climateSnowCoverage } from '../client/render/terrain-style';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const rectangle = (): WorldZone => ({ id: 'climate', name: 'Clima', priority: 1,
  shape: { kind: 'rect', x: -10, y: -5, width: 20, height: 10 }, temperature: 0, moisture: 1, climateTransition: 1 });
const authoring = (...zones: WorldZone[]) => { const d = newWorldDocument(42); d.zones = zones; return new WorldAuthoring(d); };

test('three absolute bands support a fast linear start, separate curves and an exact constant plateau', () => {
  const bands: ClimateBand[] = [{ at: .2, value: .5, curve: 1 }, { at: .8, value: .3, curve: 3 }, { at: 1, value: .1, curve: 1 }];
  const sample = (t: number, levels = bands) => { const s = climateBandState(t, levels); return 1 * (1 - s.weight) + s.value * s.weight; };
  close(sample(0), 1); close(sample(.1), .75); close(sample(.2), .5);
  close(sample(.5), .325); close(sample(.8), .3); close(sample(.9), .2); close(sample(1), .1);
  for (const at of [.2, .8]) assert.ok(Math.abs(sample(at - 1e-7) - sample(at + 1e-7)) < 1e-5);
  const plateau = [{ at: .2, value: .3 }, { at: .8, value: .3 }, { at: 1, value: .1 }];
  for (const at of [.25, .5, .75]) close(sample(at, plateau), .3);
  const low = { ...rectangle(), id: 'ambient', priority: 0, temperature: 1, moisture: .2 }; delete low.climateTransition;
  const high = rectangle(); high.climateBands = { temperature: bands };
  const a = authoring(high, low);
  // The rectangle has an inward half-width of 5 tiles.
  close(a.climateAt(-9.5, 0, 'temperature', () => 0), .75);
  close(a.climateAt(-7.5, 0, 'temperature', () => 0), .325);
  close(a.climateAt(0, 0, 'temperature', () => 0), .1);
  close(a.climateAt(0, 0, 'moisture', () => 0), 1);
  delete high.climateTransition;
  close(a.climateAt(0, 0, 'temperature', () => 0), 0);
});

test('band storage is bounded to three ordered targets with finite values and a 100% endpoint', () => {
  const d = newWorldDocument(); d.zones.push({ ...rectangle(), climateBands: { temperature: [{ at: .2, value: .5 }, { at: 1, value: .1, curve: 3 }] } });
  assert.deepEqual(parseWorldDocument(JSON.stringify(d)).zones[0].climateBands, d.zones[0].climateBands);
  const invalid = [null, [], { unknown: [] }, ...[
    [], Array.from({ length: 4 }, (_, i) => ({ at: (i + 1) / 4, value: .3 })),
    [{ at: 0, value: .5 }, { at: 1, value: .1 }], [{ at: 1, value: NaN }],
    [{ at: .5, value: .3 }], [{ at: .5, value: .3 }, { at: .5, value: .1 }],
    [{ at: 1, value: 1.1 }], [{ at: 1, value: .1, curve: 0 }],
  ].map(temperature => ({ temperature }))];
  for (const bands of invalid) { const copy = structuredClone(d); (copy.zones[0] as any).climateBands = bands; assert.throws(() => parseWorldDocument(copy), /band[ae] clima/); }
});

test('independent user curves apply to each climate property and retain monotone bounded endpoints', () => {
  const zone = rectangle(); zone.climateCurves = { temperature: 1, moisture: 6 };
  const a = authoring(zone);
  close(zoneClimateWeight(zone, -7.5, 0, 'temperature'), .5);
  close(zoneClimateWeight(zone, -7.5, 0, 'moisture'), .984375);
  close(a.climateAt(-7.5, 0, 'temperature', () => .8), .4);
  close(a.climateAt(-7.5, 0, 'moisture', () => .2), .9875);
  for (const power of [.25, .5, 1, 3, 6, 12]) {
    close(climateCurveWeight(0, power), 0); close(climateCurveWeight(1, power), 1);
    let previous = 0;
    for (let i = 0; i <= 100; i++) {
      const value = climateCurveWeight(i / 100, power);
      assert.ok(value >= previous && value <= 1); previous = value;
    }
  }
  delete zone.climateCurves.temperature;
  close(zoneClimateWeight(zone, -7.5, 0, 'temperature'), .875);
  delete zone.climateTransition;
  close(zoneClimateWeight(zone, -7.5, 0, 'moisture'), 1);
});

test('custom climate curves survive storage and reject invalid parameters', () => {
  const doc = newWorldDocument(); doc.zones.push({ ...rectangle(), climateCurves: { temperature: 12, moisture: .25 } });
  assert.deepEqual(parseWorldDocument(JSON.stringify(doc)).zones[0].climateCurves, { temperature: 12, moisture: .25 });
  for (const invalid of [null, [], '3', { unknown: 3 }, ...[0, .1, 12.01, NaN, Infinity, true, '3', null].map(temperature => ({ temperature }))]) {
    const copy = structuredClone(doc); (copy.zones[0] as any).climateCurves = invalid;
    assert.throws(() => parseWorldDocument(copy), /curve clima/);
  }
});

test('a .3 to .1 transition changes fastest outside and settles toward .1 without reversing or overshooting', () => {
  const zone = rectangle(); zone.temperature = .1; zone.climateTransition = .5;
  const a = authoring(zone);
  const values = [0, .25, .5, .75, 1].map(t => a.climateAt(-10 + t * 2.5, 0, 'temperature', () => .3));
  const expected = [.3, .184375, .125, .103125, .1];
  values.forEach((v, i) => close(v, expected[i]));
  const drops = values.slice(1).map((v, i) => values[i] - v);
  assert.ok(drops.every((drop, i) => drop > 0 && (i === 0 || drop < drops[i - 1])));
  for (let i = 0; i <= 100; i++) {
    const value = a.climateAt(-10 + i * .025, 0, 'temperature', () => .3);
    assert.ok(value >= .1 && value <= .3);
  }
});

test('snow coverage changes continuously through the former .30 and .34 thresholds', () => {
  close(climateSnowCoverage(.38), 0); close(climateSnowCoverage(.1), 1);
  close(climateSnowCoverage(0), 1); close(climateSnowCoverage(1), 0);
  for (const threshold of [.30, .34]) assert.ok(Math.abs(climateSnowCoverage(threshold - 1e-6) - climateSnowCoverage(threshold + 1e-6)) < 1e-5);
  assert.ok(climateSnowCoverage(.3) < climateSnowCoverage(.2) && climateSnowCoverage(.2) < climateSnowCoverage(.1));
});

test('rectangular blending follows every edge, handles negative coordinates and reaches the selected climate inside', () => {
  const zone = rectangle();
  for (const p of [[-10, 0], [0, -5], [0, 5], [10, 0], [-10, -5], [-11, 0]]) close(zoneClimateWeight(zone, ...p as [number, number]), 0);
  for (const p of [[-7.5, 0], [7.5, 0], [0, -2.5], [0, 2.5]]) close(zoneClimateWeight(zone, ...p as [number, number]), .875);
  close(zoneClimateWeight(zone, 0, 0), 1);
  const a = authoring(zone);
  close(a.climateAt(-7.5, 0, 'temperature', () => .8), .1);
  close(a.climateAt(-7.5, 0, 'moisture', () => .2), .9);
  close(a.climateAt(0, 0, 'temperature', () => .8), 0);
  close(a.climateAt(0, 0, 'moisture', () => .2), 1);
});

test('circular blending is radial and continuous at the boundary; adjustable depth creates a uniform core', () => {
  const zone = { ...rectangle(), shape: { kind: 'circle' as const, x: 20, y: -30, radius: 10 } };
  close(zoneClimateWeight(zone, 30, -30), 0);
  close(zoneClimateWeight(zone, 20, -30), 1);
  close(zoneClimateWeight(zone, 25, -30), .875);
  close(zoneClimateWeight(zone, 23, -26), .875);
  assert.ok(zoneClimateWeight(zone, 30 - 1e-6, -30) < 1e-6);
  zone.climateTransition = .5;
  close(zoneClimateWeight(zone, 27.5, -30), .875);
  close(zoneClimateWeight(zone, 25, -30), 1);
  close(zoneClimateWeight(zone, 20, -30), 1);
});

test('legacy zones keep hard climate overrides and non-climate rules are never blended', () => {
  const zone = rectangle(); delete zone.climateTransition;
  zone.pvp = false; zone.generateAssets = false;
  const a = authoring(zone);
  assert.equal(a.climateAt(-9.999, 0, 'temperature', () => { throw Error('unnecessary procedural sample'); }), 0);
  close(a.climateAt(-10.001, 0, 'temperature', () => .8), .8);
  zone.climateTransition = 1;
  assert.equal(a.rule(-9.999, 0, 'pvp'), false);
  assert.equal(a.rule(-9.999, 0, 'generateAssets'), false);
});

test('overlaps blend by priority per property, inherit missing properties and break ties by ID', () => {
  const low = { ...rectangle(), id: 'low', priority: 0, temperature: .8, moisture: .2 }; delete low.climateTransition;
  const high = rectangle();
  const a = authoring(high, low);
  close(a.climateAt(-10, 0, 'temperature', () => .1), .8);
  close(a.climateAt(-7.5, 0, 'temperature', () => .1), .1);
  close(a.climateAt(-7.5, 0, 'moisture', () => .1), .9);
  delete high.moisture;
  close(authoring(low, high).climateAt(0, 0, 'moisture', () => .1), .2);
  const tie = { ...low, priority: 1, id: 'a-first', temperature: .3 };
  close(authoring(high, tie).climateAt(0, 0, 'temperature', () => .1), .3);
});

test('World samples the same gradient for climate, biome and terrain generation on both runtime instances', () => {
  const doc = newWorldDocument(42), baseline = new World(42, 16, 'world', doc, []);
  const zone = rectangle(); doc.zones.push(zone);
  const a = new World(42, 16, 'world', doc, []), b = new World(42, 16, 'world', structuredClone(doc), []);
  for (const [x, y] of [[-11, 0], [-10, 0], [-7.5, 0], [0, 0], [10, 0]]) {
    const weight = zoneClimateWeight(zone, x, y);
    close(a.getTemperature(x - .5, y - .5), baseline.getTemperature(x - .5, y - .5) * (1 - weight));
    close(a.getMoisture(x * TILE_SIZE, y * TILE_SIZE), baseline.getMoisture(x * TILE_SIZE, y * TILE_SIZE) * (1 - weight) + weight);
    close(a.getMoisture(x * TILE_SIZE, y * TILE_SIZE), b.getMoisture(x * TILE_SIZE, y * TILE_SIZE));
  }
  assert.equal(a.getBiome(0, 0), 'marsh');
  for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) assert.equal(a.getTile(x, y), b.getTile(x, y));
});

test('climate transitions survive serialization; invalid values are rejected and legacy documents remain valid', () => {
  const d = newWorldDocument(); d.zones.push(rectangle());
  assert.equal(parseWorldDocument(JSON.stringify(d)).zones[0].climateTransition, 1);
  for (const bad of [0, -.1, 1.01, NaN, Infinity, true, '0.5', null]) {
    const invalid = structuredClone(d); (invalid.zones[0] as any).climateTransition = bad;
    assert.throws(() => parseWorldDocument(invalid), /transizione clima/);
  }
  delete d.zones[0].climateTransition;
  assert.equal(parseWorldDocument(d).zones[0].climateTransition, undefined);
});
