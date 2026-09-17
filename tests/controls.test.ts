import test from 'node:test';
import assert from 'node:assert/strict';
import { assignBinding, changeMovement, defaultControls, GameControls, parseControls } from '../client/controls';

const worldPoint = (x: number, y: number) => ({ x, y });
const origin = { x: 0, y: 0 };
test('controls validate saved data, reserved keys and active conflicts', () => {
  const settings = defaultControls();
  assert.match(assignBinding(settings, 'q', 0, 'KeyW')!, /Già assegnato/);
  assert.match(assignBinding(settings, 'q', 0, 'Mouse0')!, /riservato/);
  assert.equal(assignBinding(settings, 'q', 0, 'KeyF'), null);
  assert.deepEqual(parseControls(JSON.stringify(settings)), settings);
  assert.deepEqual(parseControls('{bad'), defaultControls());
  settings.bindings.e = ['KeyF'];
  assert.deepEqual(parseControls(JSON.stringify(settings)), defaultControls());
});
test('movement mode reserves its command and preserves usable combat bindings', () => {
  const settings = defaultControls();
  changeMovement(settings, 'mouse');
  assert.deepEqual(settings.bindings.basic, ['Space']);
  assert.deepEqual(parseControls(JSON.stringify(settings)), settings);
  assert.equal(assignBinding(settings, 'q', 0, 'KeyW'), null);
  changeMovement(settings, 'keyboard');
  assert.deepEqual(settings.bindings.q, ['KeyQ']);
  assert.deepEqual(parseControls(JSON.stringify(settings)), settings);
});
test('remapped keys replace defaults, normalize diagonals and repeat only the base attack', () => {
  const settings = defaultControls(); settings.bindings.right = ['KeyL']; settings.bindings.q = ['KeyF'];
  const controls = new GameControls(settings);
  assert.equal(controls.press('KeyD'), false);
  controls.press('KeyL'); controls.press('KeyW'); controls.press('KeyF');
  let input = controls.sample(origin, 1, worldPoint);
  assert.equal(Math.hypot(input.dx, input.dy), 1); assert.equal(input.cast, 'q');
  controls.consumeCast(); controls.press('KeyF');
  assert.equal(controls.sample(origin, 1, worldPoint).cast, undefined);
  controls.press('Space'); controls.consumeCast();
  assert.equal(controls.sample(origin, 1, worldPoint).cast, 'basic');
  controls.clear(); input = controls.sample(origin, 1, worldPoint);
  assert.deepEqual(input, { dx: 0, dy: 0, aim: 1, cast: undefined });
});
test('mouse movement follows cursor, stops near it and stops on release without attacking', () => {
  const settings = defaultControls(); changeMovement(settings, 'mouse');
  const controls = new GameControls(settings);
  controls.setPointer({ x: 100, y: 0 }); controls.press('Mouse2');
  assert.deepEqual(controls.sample(origin, 1, worldPoint), { dx: 1, dy: 0, aim: 0, cast: undefined });
  controls.setPointer({ x: 0, y: 100 }); controls.press('Space');
  assert.deepEqual(controls.sample(origin, 0, worldPoint), { dx: 0, dy: 1, aim: Math.PI / 2, cast: 'basic' });
  controls.release('Mouse2'); controls.release('Space');
  assert.equal(controls.sample(origin, 0, worldPoint).dy, 0);
  controls.press('Mouse2'); controls.setPointer({ x: 5, y: 0 });
  assert.equal(controls.sample(origin, 0, worldPoint).dx, 0);
});
test('touch movement is independent of bindings and keeps swipe aim for subsequent taps', () => {
  const settings = defaultControls(); settings.bindings.up = ['KeyI']; changeMovement(settings, 'mouse');
  const controls = new GameControls(settings);
  controls.setPointer({ x: 100, y: 0 }); controls.setTouchAim(Math.PI);
  controls.setTouchMovement({ x: 0, y: 1 }); controls.cast('e');
  assert.deepEqual(controls.sample(origin, 0, worldPoint), { dx: 0, dy: 1, aim: Math.PI, cast: 'e' });
  controls.consumeCast(); controls.setTouchMovement({ x: -1, y: 0 }); controls.cast('basic');
  assert.equal(controls.sample(origin, 0, worldPoint).aim, Math.PI);
  controls.clear();
  assert.deepEqual(controls.sample(origin, 0, worldPoint), { dx: 0, dy: 0, aim: 0, cast: undefined });
});
