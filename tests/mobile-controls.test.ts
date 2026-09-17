import test from 'node:test';
import assert from 'node:assert/strict';
import { joystickVector } from '../client/mobile-controls';
import { defaultControls, GameControls } from '../client/controls';
import { CLASSES } from '../shared/config';

test('joystick has a dead zone, analog travel and clamped diagonal movement', () => {
  assert.deepEqual(joystickVector(3, 4, 40), { x: 0, y: 0 });
  assert.deepEqual(joystickVector(20, 0, 40), { x: 0.5, y: 0 });
  const diagonal = joystickVector(100, 100, 40);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-10);
});

test('each class declares directional targeting for its actual abilities', () => {
  const directional = (id: keyof typeof CLASSES) => Object.entries(CLASSES[id].abilities).filter(([, ability]) => ability.targeting === 'directional').map(([slot]) => slot);
  assert.deepEqual(directional('mage'), ['basic', 'q']);
  assert.deepEqual(directional('paladin'), ['basic', 'q']);
  assert.deepEqual(directional('warrior'), ['basic', 'q', 'e']);
  assert.deepEqual(directional('hunter'), ['basic', 'q', 'e']);
});
test('simultaneous joystick and attack aim keep independent directions through ability taps', () => {
  const controls = new GameControls(defaultControls());
  controls.setTouchMovement({ x: 0.5, y: 0 }); controls.setTouchAim(-Math.PI / 2); controls.cast('basic');
  const sample = () => controls.sample({ x: 0, y: 0 }, 0, (x, y) => ({ x, y }));
  assert.deepEqual(sample(), { dx: 0.5, dy: 0, aim: -Math.PI / 2, cast: 'basic' });
  controls.consumeCast(); controls.setTouchMovement({ x: 0, y: 1 }); controls.cast('r');
  assert.deepEqual(sample(), { dx: 0, dy: 1, aim: -Math.PI / 2, cast: 'r' });
  controls.clear(); assert.deepEqual(sample(), { dx: 0, dy: 0, aim: 0, cast: undefined });
});
