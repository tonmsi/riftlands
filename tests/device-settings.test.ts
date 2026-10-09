import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAudioSettings } from '../client/controls/audio-settings';
import { parseMobileLayout } from '../client/controls/mobile-settings';

test('device preferences recover corrupt storage and independently bound volumes and mobile offsets', () => {
  assert.deepEqual(parseAudioSettings('null'), { effects: 1, music: 1 });
  assert.deepEqual(parseAudioSettings('{bad'), { effects: 1, music: 1 });
  assert.deepEqual(parseAudioSettings('{"effects":0,"music":0.35}'), { effects: 0, music: .35 });
  assert.deepEqual(parseAudioSettings('{"effects":-1,"music":10}'), { effects: 0, music: 1 });
  assert.deepEqual(parseMobileLayout('{bad'), { moveX: 0, moveY: 0, attackX: 0, attackY: 0 });
  assert.deepEqual(parseMobileLayout('{"moveX":-4,"moveY":15,"attackX":500,"attackY":"20"}'), { moveX: 0, moveY: 15, attackX: 30, attackY: 0 });
});
