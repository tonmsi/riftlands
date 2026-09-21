import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameBudget, renderDpr } from '../client/frame-budget';

test('render pacing stays at 60 FPS across display refresh rates', () => {
  for (const hz of [60, 90, 120, 144, 165, 240]) {
    const budget = new FrameBudget();
    let frames = 0;
    for (let i = 0; i < hz * 10; i++) if (budget.ready(i * 1000 / hz)) frames++;
    assert.ok(Math.abs(frames - 600) <= 1, `${hz} Hz: ${frames} frames`);
  }
});

test('pacing handles stalls, background reset and lobby rate changes', () => {
  const budget = new FrameBudget();
  assert.ok(budget.ready(0));
  assert.ok(!budget.ready(8));
  assert.ok(budget.ready(5000));
  assert.ok(!budget.ready(5008));
  budget.reset();
  assert.ok(budget.ready(5009));
  assert.ok(budget.ready(5010, 30));
  assert.ok(!budget.ready(5027, 30));
  assert.ok(budget.ready(5044, 30));
  assert.ok(budget.ready(5045, 60));
});

test('pixel budget is identical across devices and bounded on large displays', () => {
  assert.equal(renderDpr(3, 390, 844), 1);
  assert.equal(renderDpr(2, 1440, 900), 1);
  assert.equal(renderDpr(.8, 1440, 900), .8);
  const dpr = renderDpr(2, 3840, 2160);
  assert.ok(3840 * 2160 * dpr * dpr <= 2_000_001);
});
