import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSES, xpForLevel } from '../shared/config';
import { newCharacter, normalizeLoadout, equippedAbility, validLoadout, DEVELOPER_XP } from '../shared/progression';
import { RoomManager } from '../server/rooms';
import type { Account } from '../server/store';

test('normal classes start with only a basic attack; hunter stays at 20 for development', () => {
  for (const classId of Object.keys(CLASSES) as (keyof typeof CLASSES)[]) {
    assert.equal(newCharacter(classId).xp, classId === 'hunter' ? DEVELOPER_XP : 0);
    assert.deepEqual(newCharacter(classId).loadout, classId === 'hunter' ? { q: 'q', e: 'e' } : { q: null, e: null });
    for (const [level, expected] of [[1, { q: null, e: null }], [2, { q: null, e: null }], [3, { q: 'q', e: null }], [5, { q: 'q', e: null }], [6, { q: 'q', e: 'e' }], [9, { q: 'q', e: 'e' }], [10, { q: 'r', e: 'e' }]] as const) {
      const loadout = normalizeLoadout({ q: 'r', e: 'e' }, level, classId);
      assert.deepEqual(loadout, expected); assert.ok(validLoadout(loadout, level, classId));
      assert.ok(equippedAbility({ classId, loadout }, 'basic'));
      assert.equal(!!equippedAbility({ classId, loadout }, 'q'), level >= 3);
      assert.equal(!!equippedAbility({ classId, loadout }, 'e'), level >= 6);
    }
    assert.equal(validLoadout({ q: 'q', e: null }, 1, classId), false);
    assert.equal(validLoadout({ q: 'r', e: 'e' }, 9, classId), false);
  }
});

test('server rejects watching below level 20 and allows it at 20 without a bet', async () => {
  const manager = new RoomManager(undefined, 734291, 1_000_000);
  const accounts: Account[] = ['fighter-a', 'fighter-b', 'viewer'].map(id => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 }));
  for (const account of accounts) manager.connect(account, 'mage');
  for (let i = 0; i < 110; i++) manager.step(.1);
  const matchId = await manager.createMatch('arena', [[accounts[0].id], [accounts[1].id]], 180);
  const actor = manager.global.players.get('viewer')!;
  actor.level = 19;
  assert.throws(() => manager.bettingAction('viewer', { kind: 'watch', matchId }), /livello 20/);
  assert.equal(manager.snapshotFor('viewer')!.betting!.canWatch, false);
  assert.equal(manager.stateFor('viewer').spectating, undefined);
  manager.global.awardXp('viewer', xpForLevel(19));
  assert.equal(actor.level, 20);
  manager.bettingAction('viewer', { kind: 'watch', matchId });
  assert.equal(manager.stateFor('viewer').spectating, true);
  assert.equal(manager.snapshotFor('viewer')!.betting!.canWatch, true);
  manager.bettingAction('viewer', { kind: 'exit' });
  assert.equal(manager.stateFor('viewer').spectating, undefined);
});
