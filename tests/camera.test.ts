import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaViewSign, cameraZoom, parseCameraSettings, viewVector } from '../client/controls/camera-settings';
import { defaultControls, GameControls } from '../client/controls/controls';

test('camera preserves the game scale and bounds wide and tall displays', () => {
  const settings = parseCameraSettings(null);
  assert.equal(cameraZoom(1280, 900, false, settings), .95);
  assert.equal(cameraZoom(1280, 900, true, settings), .76);
  for (const [width, height] of [[5120, 1440], [1920, 3000]]) {
    const zoom = cameraZoom(width, height, false, settings);
    assert.ok(width / zoom <= 2200 / .95);
    assert.ok(height / zoom <= 1400 / .95);
  }
  assert.equal(cameraZoom(1280, 900, false, { ...settings, zoom: 2 }), 1.9);
  assert.deepEqual(parseCameraSettings('{bad'), settings);
  assert.deepEqual(parseCameraSettings('{"zoom":0,"viewLimit":"invalid"}'), settings);
});

test('both arena spawns see their opponent above them; world returns to normal', () => {
  for (const [team, spawnY] of [['match:0', -240], ['match:1', 240]] as const) {
    const sign = arenaViewSign('arena', team);
    assert.ok(viewVector({ x: 0, y: -spawnY * 2 }, sign).y < 0);
    const vector = { x: 34, y: -91 };
    assert.deepEqual(viewVector(viewVector(vector, sign), sign), vector);
  }
  assert.equal(arenaViewSign('world', 'match:0'), 1);
});

test('reflected keyboard, joystick and aim remain aligned; mouse already uses world coordinates', () => {
  const controls = new GameControls(defaultControls());
  const sample = () => controls.sample({ x: 0, y: 0 }, 0, (x, y) => ({ x, y: -y }), -1);
  controls.press('KeyW');
  assert.equal(sample().dy, 1);
  controls.clear(); controls.setTouchMovement({ x: 0, y: -1 }); controls.setTouchAim(-Math.PI / 2);
  assert.equal(sample().dy, 1); assert.equal(sample().aim, Math.PI / 2);
  controls.clear(); controls.setPointer({ x: 0, y: -100 }); controls.press('Mouse0');
  assert.equal(sample().aim, Math.PI / 2);
  controls.clear(); controls.settings.movement = 'mouse';
  controls.setPointer({ x: 0, y: -100 });
  controls.press(controls.settings.bindings.movePointer[0]);
  assert.equal(sample().dy, 1);
});
