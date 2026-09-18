import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundCues, soundPosition } from '../client/audio';
import type { Actor, GameEvent } from '../shared/types';
import { WorldSimulation } from '../server/simulation';

const actor = (): Actor => ({ ...new WorldSimulation().addPlayer({ id: 'player', name: 'Player', nameLower: 'player', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 }, 'warrior'), x: 0, y: 0, spriteMoving: true });

test('steps follow distance for self, friends and enemies, excluding pushes and teleports', () => {
  for (const kind of ['player', 'npc'] as const) {
    const cues = new SoundCues(), body = { ...actor(), kind };
    assert.deepEqual(cues.sample([body], [], [], 1000), []);
    body.x = 35;
    assert.equal(cues.sample([body], [], [], 1300)[0]?.kind, 'step');
    body.spriteMoving = false; body.x = 70;
    assert.deepEqual(cues.sample([body], [], [], 1600), []);
    body.spriteMoving = true; body.x = 1000;
    assert.deepEqual(cues.sample([body], [], [], 1900), []);
    body.hp = 0; body.x += 35;
    assert.deepEqual(cues.sample([body], [], [], 2200), []);
  }
});

test('combat audio plays once at presentation time and drops stale events', () => {
  const cues = new SoundCues();
  const event: GameEvent = { id: 'cast', kind: 'cast', at: 1000, duration: 500, x: 0, y: 0, radius: 50, color: '#fff', abilityKind: 'melee' };
  assert.deepEqual(cues.sample([], [event], [], 999), []);
  assert.equal(cues.sample([], [event], [], 1000)[0]?.kind, 'swing');
  assert.deepEqual(cues.sample([], [event], [], 1050), []);
  assert.equal(cues.sample([], [{ ...event, id: 'impact', kind: 'hit' }], [], 1100)[0]?.kind, 'hit');
  assert.deepEqual(cues.sample([], [{ ...event, id: 'old' }], [], 1500), []);
  cues.reset();
  assert.equal(cues.sample([], [event], [], 1000).length, 1);
});

test('sound attenuates with distance and pans towards the source', () => {
  assert.deepEqual(soundPosition({ x: 0, y: 0 }, { x: 0, y: 0 }), { volume: 1, pan: 0 });
  assert.equal(soundPosition({ x: 800, y: 0 }, { x: 0, y: 0 }).volume, 0);
  assert.ok(soundPosition({ x: -200, y: 0 }, { x: 0, y: 0 }).pan < 0);
});
