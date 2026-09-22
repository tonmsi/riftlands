import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../server/store';
import { BOSS_DEFINITIONS } from '../shared/bosses';
import { DUNGEON_BY_BOSS_ID } from '../shared/dungeons';

test('legacy save splits accounts and valid boss states without losing player progress', t => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-split-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'accounts.json');
  const boss = BOSS_DEFINITIONS[0];
  const state = { respawnAt: 0, corpse: DUNGEON_BY_BOSS_ID.get(boss.id)!.spawnPoints.boss, drops: [] };
  const account = { id: 'player', name: 'Player', nameLower: 'player', salt: 'salt', passwordHash: 'hash',
    kills: 3, deaths: 2, xp: 100, gold: 75, friends: [], requests: [], lastSeen: 1 };
  writeFileSync(path, JSON.stringify({ version: 2, accounts: [account], bosses: { [boss.id]: state } }));

  const store = new AccountStore(path);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { version: 2, accounts: [account] });
  assert.deepEqual(JSON.parse(readFileSync(store.dungeonPath, 'utf8')), { version: 1, bosses: { [boss.id]: state } });
  assert.equal(new AccountStore(path).accounts.get('player')!.gold, 75);

  const accountsBefore = readFileSync(path, 'utf8');
  store.bossStates = {};
  store.flushBosses();
  assert.equal(readFileSync(path, 'utf8'), accountsBefore);
  assert.deepEqual(new AccountStore(path).bossStates, {});
});

test('obsolete legacy boss states reset while account data survives', t => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-obsolete-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'accounts.json');
  writeFileSync(path, JSON.stringify({ version: 2, accounts: [], bosses: { 'boss:removed': {} } }));
  const store = new AccountStore(path);
  assert.deepEqual(store.bossStates, {});
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { version: 2, accounts: [] });
});

test('incompatible dungeon file is backed up and reset without editing accounts', t => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-reset-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'accounts.json'), dungeonPath = join(directory, 'dungeon.json');
  const accounts = JSON.stringify({ version: 2, accounts: [] });
  writeFileSync(path, accounts);
  writeFileSync(dungeonPath, JSON.stringify({ version: 1, bosses: { 'boss:old': {} } }));
  const store = new AccountStore(path);
  assert.deepEqual(store.bossStates, {});
  assert.equal(readFileSync(path, 'utf8'), accounts);
  assert.deepEqual(JSON.parse(readFileSync(dungeonPath, 'utf8')), { version: 1, bosses: {} });
  assert.equal(readdirSync(directory).filter(name => name.startsWith('dungeon.json.invalid-') && name.endsWith('.bak')).length, 1);
});
