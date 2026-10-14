import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAudioSettings } from '../client/controls/audio-settings';
import { parseMobileLayout } from '../client/controls/mobile-settings';
import { MobileFrameRate, parseMobileFrameRate } from '../client/controls/mobile-performance';

test('device preferences recover corrupt storage and independently bound volumes and mobile offsets', () => {
  assert.deepEqual(parseAudioSettings('null'), { effects: 1, music: 1 });
  assert.deepEqual(parseAudioSettings('{bad'), { effects: 1, music: 1 });
  assert.deepEqual(parseAudioSettings('{"effects":0,"music":0.35}'), { effects: 0, music: .35 });
  assert.deepEqual(parseAudioSettings('{"effects":-1,"music":10}'), { effects: 0, music: 1 });
  assert.deepEqual(parseMobileLayout('{bad'), { moveX: 0, moveY: 0, attackX: 0, attackY: 0 });
  assert.deepEqual(parseMobileLayout('{"moveX":-4,"moveY":15,"attackX":500,"attackY":"20"}'), { moveX: 0, moveY: 15, attackX: 30, attackY: 0 });
});

test('mobile cadence tolerates isolated stalls and lowers sustained overload without oscillation', () => {
  const cadence = new MobileFrameRate();
  for (let i=0;i<120;i++) cadence.observe(i%50===0?150:1000/60);
  assert.equal(cadence.fps,60);
  for (let i=0;i<60;i++) cadence.observe(1000/30);
  assert.equal(cadence.fps,30);
  for (let i=0;i<120;i++) cadence.observe(1000/60);
  assert.equal(cadence.fps,30);
  cadence.reset(); assert.equal(cadence.fps,60);
  for (let i=0;i<120;i++) cadence.observe(i%2?1000/90:2000/90);
  assert.equal(cadence.fps,60);
  assert.equal(parseMobileFrameRate('30'),30); assert.equal(parseMobileFrameRate('60'),60);
  assert.equal(parseMobileFrameRate(null),'auto'); assert.equal(parseMobileFrameRate('corrupt'),'auto');
});
