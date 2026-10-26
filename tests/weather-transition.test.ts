import test from 'node:test';
import assert from 'node:assert/strict';
import { WeatherTransition, type WeatherAppearance } from '../client/render/weather-transition';

function fixture(temperature = .7, storm = false) {
  const weather = new WeatherTransition(); let time = 0;
  let state = weather.update(time, temperature, storm);
  return {
    weather, state: () => state,
    advance(seconds: number, temp: number, wet: boolean, outdoors = true, step = 20) {
      for (let elapsed = 0; elapsed < seconds * 1000; elapsed += step) {
        const dt = Math.min(step, seconds * 1000 - elapsed); time += dt;
        state = weather.update(time, temp, wet, outdoors);
      }
      return state;
    },
  };
}
const precipitation = (s: WeatherAppearance) => s.rain + s.snow;
test('clouds arrive before rain and clear more slowly than precipitation', () => {
  const f = fixture(); assert.deepEqual(f.state(), { rain: 0, snow: 0, darkness: 0, snowMix: 0 });
  f.advance(5, .7, false); assert.equal(f.state().darkness, 0);
  const first = f.advance(.1, .7, true); assert.ok(first.darkness > 0); assert.equal(first.rain, 0);
  const rain = f.advance(15, .7, true); assert.ok(rain.rain > .97); assert.ok(rain.darkness > .2);
  const clearing = f.advance(3, .7, false);
  assert.ok(clearing.rain > 0 && clearing.rain < rain.rain);
  assert.ok(clearing.darkness / rain.darkness > clearing.rain / rain.rain);
  const clear = f.advance(40, .7, false); assert.ok(clear.rain < .00001 && clear.darkness < .0002);
});
test('rain crosses through sleet to snow without clearing the sky or stopping precipitation', () => {
  const f = fixture(.7, true); const rain = f.advance(40, .7, true);
  assert.ok(rain.rain > .99);
  let previous = rain, mixed = false;
  for (let i = 0; i < 1000; i++) {
    const s = f.advance(.02, .1, true);
    mixed ||= s.rain > .1 && s.snow > .1;
    assert.ok(precipitation(s) > .99); assert.ok(s.darkness >= .159 && s.darkness <= .221);
    assert.ok(Math.abs(s.snow - previous.snow) < .009);
    assert.ok(Math.abs(s.darkness - previous.darkness) < .001);
    previous = s;
  }
  assert.ok(mixed); assert.ok(f.state().snow > .995 && f.state().rain < .005);
  assert.ok(f.state().darkness < rain.darkness && f.state().darkness > .16);
});
test('rapid warm/cold boundary crossings retarget smoothly, without restarting or queuing transitions', () => {
  const f = fixture(.1, true); let previous = f.advance(40, .1, true);
  for (let i = 0; i < 1000; i++) {
    const temp = Math.floor(i / 5) % 2 ? .1 : .8;
    const s = f.advance(.02, temp, true);
    assert.ok(Math.abs(s.snow - previous.snow) < .009);
    assert.ok(Math.abs(s.darkness - previous.darkness) < .001);
    assert.ok(precipitation(s) > .99); previous = s;
  }
  const warm = f.advance(30, .8, true);
  assert.ok(warm.rain > .999 && warm.snow < .001);
  const cold = f.advance(30, .1, true);
  assert.ok(cold.snow > .999 && cold.rain < .001);
});
test('intermediate temperature supports persistent sleet; frame rates and pause gaps stay stable', () => {
  const f = fixture(.28, true); const s = f.advance(40, .28, true);
  assert.ok(Math.abs(s.rain - .5) < .001 && Math.abs(s.snow - .5) < .001);
  const slow = fixture(.8, true), fast = fixture(.8, true);
  slow.advance(40, .8, true); fast.advance(40, .8, true);
  const a = slow.advance(6, .1, true, true, 1000 / 30), b = fast.advance(6, .1, true, true, 1000 / 120);
  assert.ok(Math.abs(a.snow - b.snow) < .01); assert.ok(Math.abs(a.darkness - b.darkness) < .001);
  const paused = new WeatherTransition(); paused.update(0, .8, true);
  assert.ok(paused.update(120_000, .8, true).darkness < .01);
});
test('interiors and warp veils clear weather immediately; returning outdoors fades from clear', () => {
  const f = fixture(.1, true); f.advance(40, .1, true);
  assert.deepEqual(f.advance(.1, .1, true, false), { rain: 0, snow: 0, darkness: 0, snowMix: 0 });
  const outside = f.advance(.02, .1, true); assert.equal(outside.snow, 0); assert.equal(outside.darkness, 0);
  assert.ok(f.advance(15, .1, true).snow > .97);
});
