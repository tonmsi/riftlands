import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorldDocument, parseWorldDocument, type WorldSoundPoint } from '../shared/world-schema';
import { mapDocument } from '../shared/warps';
import { forkWorldDocument } from '../shared/world-editing';
import { soundPointMix } from '../client/core/sound-points';

const point: WorldSoundPoint = { id: 'inn', name: 'Locanda', x: 0, y: 0, innerRadius: 2, radius: 10, music: { src: '/music/inn.ogg', volume: .8 } };
test('localized music has a full-volume core, smooth attenuation, silence outside and stereo direction', () => {
  assert.deepEqual(soundPointMix(point, { x: .5, y: .5 }), { volume: .8, pan: 0 });
  assert.equal(soundPointMix(point, { x: 2.5, y: .5 }).volume, .8);
  assert.equal(soundPointMix(point, { x: 6.5, y: .5 }).volume, .4);
  assert.equal(soundPointMix(point, { x: 10.5, y: .5 }).volume, 0);
  assert.equal(soundPointMix(point, { x: 100, y: .5 }).volume, 0);
  assert.ok(soundPointMix(point, { x: -3, y: .5 }).pan > 0);
  assert.ok(soundPointMix(point, { x: 3, y: .5 }).pan < 0);
  assert.equal(soundPointMix({ ...point, music: undefined }, { x: .5, y: .5 }).volume, 0);
});
test('sound points roundtrip, stay isolated between maps and support old documents', () => {
  const doc = newWorldDocument(); doc.soundPoints = [structuredClone(point)];
  doc.interiors = [{ id: 'room', name: 'Sala', width: 20, height: 20, document: { ...newWorldDocument(), soundPoints: [{ ...point, id: 'inside' }] } }];
  const parsed = parseWorldDocument(JSON.stringify(doc));
  assert.deepEqual(parsed.soundPoints, [point]);
  assert.equal(mapDocument(parsed, 'room').soundPoints?.[0].id, 'inside');
  const fork = forkWorldDocument(parsed); fork.soundPoints![0].radius = 20;
  assert.equal(parsed.soundPoints![0].radius, 10);
  assert.equal(parseWorldDocument(newWorldDocument()).soundPoints, undefined);
});
test('sound point parser rejects invalid radii, coordinates, IDs and music', () => {
  for (const patch of [{ radius: 0 }, { radius: 2000 }, { innerRadius: -1 }, { innerRadius: 10 }, { x: .5 }, { name: '' }, { music: { src: 'https://example.com/a.mp3', volume: .5 } }, { music: { src: '/music/a.mp3', volume: 2 } }]) {
    assert.throws(() => parseWorldDocument({ ...newWorldDocument(), soundPoints: [{ ...point, ...patch }] }), /punto sonoro/);
  }
  assert.throws(() => parseWorldDocument({ ...newWorldDocument(), soundPoints: [point, point] }), /duplicati/);
});
