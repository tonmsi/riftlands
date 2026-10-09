import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../server/store';
import { BOSS_DEFINITIONS } from '../shared/bosses';
import { DUNGEON_BY_BOSS_ID } from '../shared/dungeons';

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
