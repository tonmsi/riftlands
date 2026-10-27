import test from 'node:test';
import assert from 'node:assert/strict';
import { bossSpriteSlots, characterSpriteSlots } from '../client/editors/actor-sprite-slots';

test('player sprite slots use each class ability names and combat types, preserving saved animation IDs', () => {
  const mage = characterSpriteSlots(['moving', 'q'], { classId: 'mage' });
  const warrior = characterSpriteSlots(['moving'], { classId: 'warrior' });
  assert.equal(mage.find(s => s.id === 'basic')?.label, 'Ranged · Dardo arcano');
  assert.equal(mage.find(s => s.id === 'q')?.label, 'Ranged · Lancia di gelo');
  assert.equal(mage.find(s => s.id === 'e')?.label, 'AoE · Nova arcana');
  assert.equal(mage.find(s => s.id === 'r')?.label, 'Scudo · Velo astrale');
  assert.equal(warrior.find(s => s.id === 'basic')?.label, 'Melee · Fendente');
  assert.equal(warrior.find(s => s.id === 'q')?.label, 'Melee · Spaccaterra');
  assert.equal(new Set(mage.map(s => s.id)).size, mage.length);
});

test('boss slots show legacy walk as Movement and group named attacks by the animation used in combat', () => {
  const attack = { damage: 10, range: 40, radius: 20, windupMs: 100, cooldownMs: 1000 };
  const slots = bossSpriteSlots(['idle', 'walk', 'melee'], [
    { ...attack, kind: 'melee', name: 'Colpo del custode' },
    { ...attack, kind: 'melee', name: 'Colpo del custode' },
    { ...attack, kind: 'slam' },
  ]);
  assert.equal(slots.find(s => s.id === 'melee')?.label, 'Melee · Colpo del custode');
  assert.equal(slots.find(s => s.id === 'slam')?.label, 'AoE · Schianto');
  assert.equal(slots.filter(s => s.id === 'moving').length, 1);
  assert.equal(slots.some(s => s.id === 'walk'), false);
  assert.equal(slots.find(s => s.id === 'prep')?.label, 'Risveglio');
  assert.equal(slots.some(s => s.id === 'q'), false);
});

test('unnamed mob attacks use their actual combat type; NPCs never inherit player class abilities', () => {
  const wisp = characterSpriteSlots(['moving'], { npcKind: 'wisp' });
  const slime = characterSpriteSlots(['idle'], { npcKind: 'slime' });
  assert.equal(wisp.find(s => s.id === 'basic')?.label, 'Ranged');
  assert.equal(slime.find(s => s.id === 'basic')?.label, 'Melee');
  assert.equal(wisp.some(s => ['q', 'e', 'r'].includes(s.id)), false);
  const neutral = characterSpriteSlots(['idle', 'slam'], { npcKind: 'old-fisher' });
  assert.deepEqual(neutral.filter(s => ['melee', 'ranged', 'aoe'].includes(s.id)).map(s => s.label), ['Melee', 'Ranged', 'AoE']);
  assert.equal(neutral.find(s => s.id === 'slam')?.label, 'AoE');
});
