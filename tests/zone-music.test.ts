import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { WorldAuthoring } from '../shared/world-authoring';
import { importWorldMusic, listWorldMusic } from '../scripts/music-library';

test('music is selected by zone priority, survives parsing and rejects external URLs and invalid gain', () => {
  const document = newWorldDocument();
  document.zones = [
    { id: 'outer', name: 'Bosco', priority: 0, shape: { kind: 'rect', x: 0, y: 0, width: 20, height: 20 }, music: { src: '/music/forest.mp3', volume: .5 } },
    { id: 'inner', name: 'Locanda', priority: 5, shape: { kind: 'circle', x: 10, y: 10, radius: 3 }, music: { src: '/music/inn.ogg', volume: .3 } },
  ];
  const world = new WorldAuthoring(parseWorldDocument(document));
  assert.equal(world.rule(1, 1, 'music')?.src, '/music/forest.mp3');
  assert.equal(world.rule(10, 10, 'music')?.src, '/music/inn.ogg');
  assert.equal(world.rule(50, 50, 'music'), undefined);
  document.zones[0].music!.src = 'https://example.org/song.mp3'; assert.throws(() => parseWorldDocument(document), /musica/);
  document.zones[0].music = { src: '/music/song.mp3', volume: 2 }; assert.throws(() => parseWorldDocument(document), /musica/);
});

test('music uploads are bounded local files, deduplicated including project reimport', async () => {
  const root = await mkdtemp(join(tmpdir(), 'riftlands-music-'));
  try {
    assert.deepEqual(await listWorldMusic(root), []);
    const bytes = Buffer.alloc(48); bytes.write('RIFF'); bytes.write('WAVE', 8);
    const src = await importWorldMusic(root, 'Bosco.wav', bytes.toString('base64'));
    assert.equal(await importWorldMusic(root, src.split('/').at(-1), bytes.toString('base64')), src);
    assert.deepEqual(await listWorldMusic(root), [src]);
    await assert.rejects(importWorldMusic(root, '../escape.wav', bytes.toString('base64')));
    await assert.rejects(importWorldMusic(root, 'bad.mp3', bytes.toString('base64')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
