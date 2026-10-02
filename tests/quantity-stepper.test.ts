import test from 'node:test';
import assert from 'node:assert/strict';
import { quantityRepeatInterval } from '../client/quantity-stepper';

test('held quantity control accelerates smoothly and never exceeds five repeats per second', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(quantityRepeatInterval), [500, 425, 350, 275, 200, 200]);
  assert.equal(quantityRepeatInterval(10_000), 200);
  assert.equal(quantityRepeatInterval(-1), 500);
});
