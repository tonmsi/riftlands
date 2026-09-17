import test from 'node:test';
import assert from 'node:assert/strict';
import { playerSpriteDirectionRow, spriteDirectionRow } from '../client/sprite-direction';

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

test('mobile player faces north/south with imprecise input and keeps stable diagonal sectors', () => {
  assert.equal(playerSpriteDirectionRow(0.12, -0.9, 3, true), 1);
  assert.equal(playerSpriteDirectionRow(-0.15, 0.8, 2, true), 0);
  assert.equal(playerSpriteDirectionRow(0.7, -0.72, 3, true), 3, 'small diagonal jitter retains east');
  assert.equal(playerSpriteDirectionRow(0.7, -0.9, 3, true), 1, 'deliberate upward movement changes to north');
  assert.equal(playerSpriteDirectionRow(0.72, -0.7, 1, true), 1, 'small diagonal jitter retains north');
  assert.equal(playerSpriteDirectionRow(-0.95, 0.15, 1, true), 2);
  assert.equal(playerSpriteDirectionRow(0, 0, 1, true), 1);
  assert.equal(playerSpriteDirectionRow(1, -1, 1, false), 3, 'keyboard diagonal behavior is unchanged');
});
