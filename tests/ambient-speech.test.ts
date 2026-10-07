import test from 'node:test';
import assert from 'node:assert/strict';
import { AmbientSpeech, SPEECH_COOLDOWN_MS, SPEECH_GAP_MS } from '../client/core/ambient-speech';
import { AMBIENT_SPEECH } from '../shared/ambient-speech';
import { World } from '../shared/world';
import { collidesWorld, hasLineOfSight } from '../shared/physics';
import { TILE_SIZE } from '../shared/config';
import type { Actor } from '../shared/types';

const self = { id: 'alice', kind: 'player', classId: 'warrior', hp: 100, x: 0, y: 0 } as Actor;
const npc = { id: 'brugo', kind: 'npc', npcKind: 'dock-skeptic', disposition: 'neutral', hp: 100, x: 100, y: 0 } as Actor;
const far = { ...self, x: -500 };
const start = 1_000_000;
function storage() {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
}

test('two viewers trigger independent speech and do not restart each other', () => {
  const a = new AmbientSpeech(), b = new AmbientSpeech();
  const first = a.update(self, [npc], start, true)!;
  assert.equal(b.update({ ...self, id: 'bob' }, [npc], start + 3000, true)?.text, first.text);
  assert.equal(a.update(self, [npc], start + 3000, true)?.startedAt, start);
});

test('lingering and radius jitter stay silent; cooldown requires another departure and return', () => {
  const speech = new AmbientSpeech(undefined, () => 0);
  assert.ok(speech.update(self, [npc], start, true));
  assert.equal(speech.update(self, [npc], start + SPEECH_COOLDOWN_MS, true), null);
  speech.update({ ...self, x: -100 }, [npc], start + SPEECH_COOLDOWN_MS + 1, true);
  assert.equal(speech.update(self, [npc], start + SPEECH_COOLDOWN_MS + 2, true), null);
  speech.update(far, [npc], start + SPEECH_COOLDOWN_MS + 3, true);
  assert.equal(speech.update(self, [npc], start + SPEECH_COOLDOWN_MS + 4, true)?.text, AMBIENT_SPEECH['dock-skeptic']!.lines[0]);
});

test('returning before cooldown does not queue a repeat while standing nearby', () => {
  const speech = new AmbientSpeech();
  speech.update(self, [npc], start, true); speech.update(far, [npc], start + 20_000, true);
  assert.equal(speech.update(self, [npc], start + 21_000, true), null);
  assert.equal(speech.update(self, [npc], start + SPEECH_COOLDOWN_MS + 1, true), null);
});

test('intro and variant rotation survive reload, separately for each character', () => {
  const saved = storage();
  new AmbientSpeech(saved).update(self, [npc], start, true);
  const reloaded = new AmbientSpeech(saved, () => 0);
  assert.equal(reloaded.update(self, [npc], start + 1000, true), null);
  reloaded.update(far, [npc], start + SPEECH_COOLDOWN_MS, true);
  assert.equal(reloaded.update(self, [npc], start + SPEECH_COOLDOWN_MS + 1, true)?.text, AMBIENT_SPEECH['dock-skeptic']!.lines[0]);
  assert.equal(new AmbientSpeech(saved).update({ ...self, classId: 'mage' }, [npc], start + SPEECH_COOLDOWN_MS + 1, true)?.text, AMBIENT_SPEECH['dock-skeptic']!.intro);
  assert.equal(new AmbientSpeech(saved, () => 0).update(self, [npc], start + SPEECH_COOLDOWN_MS * 2 + 2, true)?.text, AMBIENT_SPEECH['dock-skeptic']!.lines[1]);
});

test('introductions are guaranteed; repeats roll once per eligible entry after 45 seconds', () => {
  let rolls = 0;
  const speech = new AmbientSpeech(undefined, () => { rolls++; return rolls === 1 ? .75 : .25; });
  assert.equal(SPEECH_COOLDOWN_MS, 45_000);
  assert.equal(speech.update(self, [npc], start, true)?.text, AMBIENT_SPEECH['dock-skeptic']!.intro);
  assert.equal(rolls, 0);
  speech.update(far, [npc], start + 30_000, true);
  assert.equal(speech.update(self, [npc], start + 30_001, true), null);
  assert.equal(rolls, 0);
  speech.update(far, [npc], start + 45_000, true);
  assert.equal(speech.update(self, [npc], start + 45_001, true), null);
  assert.equal(rolls, 1);
  assert.equal(speech.update(self, [npc], start + 60_000, true), null);
  assert.equal(rolls, 1);
  speech.update(far, [npc], start + 60_001, true);
  assert.equal(speech.update(self, [npc], start + 60_002, true)?.text, AMBIENT_SPEECH['dock-skeptic']!.lines[0]);
  assert.equal(rolls, 2);
});

test('a silent priority winner does not hand speech to a neighbour or consume its introduction', () => {
  const saved = storage();
  saved.setItem('riftlands:ambient:v1:alice:warrior', JSON.stringify({
    'old-fisher:nereo': { intro: true, next: 0, at: start - SPEECH_COOLDOWN_MS },
  }));
  const speech = new AmbientSpeech(saved, () => .5);
  const nereo = { ...npc, id: 'nereo', npcKind: 'old-fisher', x: 170, questMarker: 'active' } as Actor;
  assert.equal(speech.update(self, [npc, nereo], start, true), null);
  assert.equal(speech.update(self, [npc, nereo], start + 20_000, true), null);
  speech.update(far, [npc], start + 20_001, true);
  assert.equal(speech.update(self, [npc], start + 20_002, true)?.text, AMBIENT_SPEECH['dock-skeptic']!.intro);
});

test('repeat probability uses the 50 percent boundary', () => {
  for (const value of [.499, .5]) {
    const saved = storage();
    saved.setItem('riftlands:ambient:v1:alice:warrior', JSON.stringify({
      'dock-skeptic:brugo': { intro: true, next: 0, at: start - SPEECH_COOLDOWN_MS },
    }));
    const result = new AmbientSpeech(saved, () => value).update(self, [npc], start, true);
    assert.equal(!!result, value < .5);
  }
});

test('blocked UI, death and occlusion do not consume introductions; actor removal closes speech', () => {
  const speech = new AmbientSpeech();
  assert.equal(speech.update(self, [npc], start, false), null);
  assert.equal(speech.update({ ...self, hp: 0 }, [npc], start, true), null);
  assert.equal(speech.update(self, [npc], start, true, () => false), null);
  assert.equal(speech.update(self, [npc], start, true)?.text, AMBIENT_SPEECH['dock-skeptic']!.intro);
  assert.equal(speech.update(self, [], start + 1, true), null);
});

test('nearby losers stay silent after the winner finishes; storage failures are harmless', () => {
  const speech = new AmbientSpeech({ getItem: () => { throw Error(); }, setItem: () => { throw Error(); } });
  const ada = { ...npc, id: 'ada', npcKind: 'outpost-vendor', x: 140 } as Actor;
  assert.equal(speech.update(self, [ada, npc], start, true)?.actorId, npc.id);
  assert.equal(speech.update(self, [ada, npc], start + 8000, true), null);
  assert.equal(speech.update(self, [ada, npc], start + 20_000, true), null);
  speech.update(far, [ada, npc], start + 21_000, true);
  assert.equal(speech.update(self, [ada, npc], start + 22_000, true)?.actorId, ada.id);
});

test('an active quest outranks an unseen introduction even when farther away', () => {
  const speech = new AmbientSpeech();
  const nereo = { ...npc, id: 'nereo', npcKind: 'old-fisher', x: 170, questMarker: 'active' } as Actor;
  assert.equal(speech.update(self, [npc, nereo], start, true)?.actorId, nereo.id);
  assert.equal(speech.update(self, [npc, nereo], start + 20_000, true), null);
});

test('an unseen introduction outranks a nearer ordinary line; equals use distance', () => {
  const saved = storage();
  saved.setItem('riftlands:ambient:v1:alice:warrior', JSON.stringify({
    'dock-skeptic:brugo': { intro: true, next: 0, at: start - SPEECH_COOLDOWN_MS },
  }));
  const ada = { ...npc, id: 'ada', npcKind: 'outpost-vendor', x: 170 } as Actor;
  assert.equal(new AmbientSpeech(saved).update(self, [npc, ada], start, true)?.actorId, ada.id);
  assert.equal(new AmbientSpeech().update(self, [ada, npc], start, true)?.actorId, npc.id);
});

test('NPCs entering during active speech or the global lock never speak later automatically', () => {
  for (const duringBubble of [true, false]) {
    const speech = new AmbientSpeech();
    const first = speech.update(self, [npc], start, true)!;
    const ada = { ...npc, id: 'ada', npcKind: 'outpost-vendor', x: 140 } as Actor;
    const entryAt = duringBubble ? start + 1000 : first.endsAt + 1;
    const result = speech.update(self, [npc, ada], entryAt, true);
    assert.equal(result?.actorId ?? null, duringBubble ? npc.id : null);
    assert.equal(speech.update(self, [npc, ada], first.endsAt + SPEECH_GAP_MS + 1, true), null);
    speech.update(far, [npc, ada], first.endsAt + SPEECH_GAP_MS + 2, true);
    assert.equal(speech.update(self, [npc, ada], first.endsAt + SPEECH_GAP_MS + 3, true)?.actorId, ada.id);
  }
});

test('active speech is never interrupted by a higher priority NPC; cooldown still applies to quest NPCs', () => {
  const speech = new AmbientSpeech();
  const first = speech.update(self, [npc], start, true)!;
  const nereo = { ...npc, id: 'nereo', npcKind: 'old-fisher', x: 140, questMarker: 'active' } as Actor;
  assert.equal(speech.update(self, [npc, nereo], start + 1000, true)?.actorId, npc.id);
  assert.equal(speech.update(self, [npc, nereo], first.endsAt + SPEECH_GAP_MS + 1, true), null);
  speech.update(far, [npc, nereo], start + 20_000, true);
  assert.equal(speech.update(self, [npc, nereo], start + 21_000, true)?.actorId, nereo.id);
  speech.update(far, [npc, nereo], start + 40_000, true);
  assert.equal(speech.update(self, [npc, nereo], start + 41_000, true), null);
});

test('authored skeptic is on walkable terrain within sight of spawn', () => {
  const world = new World();
  const p = world.authoring.document.npcs.find(n => n.npcKind === 'dock-skeptic')!;
  const point = { x: (p.x + .5) * TILE_SIZE, y: (p.y + .5) * TILE_SIZE };
  const spawn = world.authoring.document.spawn;
  const origin = { x: (spawn.x + .5) * TILE_SIZE, y: (spawn.y + .5) * TILE_SIZE };
  assert.equal(collidesWorld(point.x, point.y, 18, world), false);
  assert.equal(hasLineOfSight(origin, point, world), true);
});
