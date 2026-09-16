import test from 'node:test';
import assert from 'node:assert/strict';
import { spriteDirectionRow } from '../client/sprite-direction';

test('NPC and boss sprite directions use stable 45-degree cardinal boundaries', () => {
  assert.equal(spriteDirectionRow(0, 1), 0, 'south/front');
  assert.equal(spriteDirectionRow(0, -1), 1, 'north/back');
  assert.equal(spriteDirectionRow(-1, 0), 2, 'west');
  assert.equal(spriteDirectionRow(1, 0), 3, 'east');

  const at44 = 44 * Math.PI / 180, at46 = 46 * Math.PI / 180;
  assert.equal(spriteDirectionRow(Math.sin(at44), -Math.cos(at44)), 1, 'north keeps 44 degrees');
  assert.equal(spriteDirectionRow(Math.sin(at46), -Math.cos(at46)), 3, '46 degrees switches to east');
  assert.equal(spriteDirectionRow(-Math.sin(at44), Math.cos(at44)), 0, 'south keeps 44 degrees');
  assert.equal(spriteDirectionRow(-Math.sin(at46), Math.cos(at46)), 2, '46 degrees switches to west');
  assert.equal(spriteDirectionRow(0, 0, 3), 3, 'idle actors preserve their last direction');
});
