import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoomManager } from '../server/rooms';
import { AccountStore, type Account } from '../server/store';
import { arenaOdds } from '../shared/betting';
import { ARENA_GATE } from '../shared/arena';
import { TILE_SIZE } from '../shared/config';

function advance(manager: RoomManager, seconds: number) { for (let i = 0; i < seconds * 10; i++) manager.step(.1); }
async function setup(store?: AccountStore) {
  const manager = new RoomManager(store, 734291, 1_000_000);
  const accounts: Account[] = ['FighterA', 'FighterB', 'Bettor'].map(name => store ? store.register(name, 'password').account : ({ id: name, name, nameLower: name.toLowerCase(), salt: '', passwordHash: '', kills: 0, deaths: 0, xp: 0, gold: 100, friends: [], requests: [], lastSeen: 0 }));
  accounts.forEach(a => { a.gold = 100; manager.connect(a, 'mage'); });
  Object.assign(manager.global.players.get(accounts[2].id)!, { x: ARENA_GATE.x + 3 * TILE_SIZE, y: ARENA_GATE.y });
  advance(manager, 11);
  const npc = manager.global.npcs.get('authored:npc-arena-bookmaker')!;
  assert.ok(npc, 'bookmaker is present in the authored world');
  Object.assign(manager.global.players.get(accounts[2].id)!, { x: npc.x, y: npc.y });
  const matchId = await manager.createMatch('arena', [[accounts[0].id], [accounts[1].id]], 180);
  return { manager, accounts, matchId };
}

test('odds favour level and smoothed K/D, with bounded payouts for new accounts', () => {
  const odds = arenaOdds([{ level: 10, kills: 20, deaths: 5 }, { level: 1, kills: 0, deaths: 0 }]);
  assert.ok(odds[0] < odds[1]); assert.ok(odds.every(n => n >= 1 && n <= 10));
  assert.deepEqual(arenaOdds([{ level: 1, kills: 0, deaths: 0 }, { level: 1, kills: 0, deaths: 0 }]), [1.89, 1.89]);
});
