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

test('10-second betting window freezes combat; validation and closing are authoritative', async () => {
  const { manager, accounts: [a, b, bettor], matchId } = await setup();
  const room = manager.rooms.get(matchId)!;
  const actor = room.simulation.players.get(a.id)!;
  const state = manager.stateFor(a.id);
  manager.enqueueInput(a.id, { seq: 1, dx: 1, dy: 0, aim: 0, cast: 'q' }, state.id, state.epoch);
  for (let seq = 2; seq <= 300; seq++) {
    assert.equal(manager.enqueueInput(a.id, { seq, dx: 1, dy: 0, aim: 0, cast: 'q' }, state.id, state.epoch), true);
  }
  assert.equal(manager.snapshotFor(a.id)!.ack, 300);
  assert.equal(room.simulation.connections.get(a.id)!.inputs.length, 0);
  const position = { x: actor.x, y: actor.y, hp: actor.hp };
  advance(manager, 9);
  assert.deepEqual({ x: actor.x, y: actor.y, hp: actor.hp }, position);
  assert.throws(() => manager.bettingAction(a.id, { kind: 'bet', matchId, playerId: b.id, stake: 10 }));
  for (const stake of [-1, 0, .5, NaN, 101, 10001]) assert.throws(() => manager.bettingAction(bettor.id, { kind: 'bet', matchId, playerId: a.id, stake }));
  manager.bettingAction(bettor.id, { kind: 'bet', matchId, playerId: a.id, stake: 10 });
  assert.equal(bettor.gold, 90);
  assert.throws(() => manager.bettingAction(bettor.id, { kind: 'bet', matchId, playerId: b.id, stake: 10 }));
  advance(manager, 1.1);
  assert.equal(room.market!.phase, 'live');
  assert.equal(manager.enqueueInput(a.id, { seq: 301, dx: 1, dy: 0, aim: 0 }, state.id, state.epoch), true);
  manager.step(.1);
  assert.ok(actor.x > position.x, 'movement resumes after the countdown despite more than 120 earlier packets');
  assert.throws(() => manager.bettingAction(bettor.id, { kind: 'bet', matchId, playerId: a.id, stake: 10 }));
});

test('spectator has no arena body, cannot act, sees both fighters, exits and gets paid once', async () => {
  const { manager, accounts: [a, b, bettor], matchId } = await setup();
  const origin = manager.global.players.get(bettor.id)!;
  const position = { x: origin.x, y: origin.y };
  manager.bettingAction(bettor.id, { kind: 'bet', matchId, playerId: a.id, stake: 10 });
  manager.bettingAction(bettor.id, { kind: 'watch', matchId });
  const room = manager.rooms.get(matchId)!;
  assert.equal(room.members.size, 2); assert.equal(room.simulation.players.has(bettor.id), false);
  assert.equal(manager.global.players.has(bettor.id), false);
  const state = manager.stateFor(bettor.id);
  assert.equal(state.spectating, true);
  manager.enqueueInput(bettor.id, { seq: 999, dx: 1, dy: 1, aim: 0, cast: 'q' }, state.id, state.epoch);
  assert.equal(manager.interact(bettor.id, { kind: 'talk', targetId: a.id }, state.id, state.epoch), false);
  const snapshot = manager.snapshotFor(bettor.id)!;
  assert.equal(snapshot.betting!.spectating, matchId); assert.equal(snapshot.actors.length, 2);
  assert.equal(snapshot.inventory, undefined); assert.equal(snapshot.gold, 90);
  advance(manager, 10.1);
  room.simulation.players.get(b.id)!.hp = 0;
  manager.step(.1);
  assert.equal(bettor.arenaBets![0].status, 'won');
  assert.equal(bettor.gold, 108);
  assert.equal(manager.stateFor(bettor.id).mode, 'world');
  assert.equal(manager.snapshotFor(bettor.id)!.betting!.inCombat, false, 'leaving the tribune is not combat');
  const returned = manager.global.players.get(bettor.id)!;
  assert.deepEqual({ x: returned.x, y: returned.y }, position);
  manager.closeMatch(matchId); assert.equal(bettor.gold, 108);
});

test('abandonment refunds wagers and disconnecting a spectator leaves the match intact', async () => {
  const { manager, accounts: [a, , bettor], matchId } = await setup();
  manager.bettingAction(bettor.id, { kind: 'bet', matchId, playerId: a.id, stake: 20 });
  manager.bettingAction(bettor.id, { kind: 'watch', matchId });
  manager.disconnect(bettor.id);
  assert.equal(manager.rooms.get(matchId)!.members.size, 2);
  manager.disconnect(a.id, true); manager.step(.1);
  assert.equal(bettor.arenaBets![0].status, 'refunded'); assert.equal(bettor.gold, 100);
});

test('restart refunds persisted active bets exactly once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-bets-'));
  try {
    const path = join(directory, 'accounts.json');
    const store = new AccountStore(path);
    const { manager, accounts: [a, , bettor], matchId } = await setup(store);
    manager.bettingAction(bettor.id, { kind: 'bet', matchId, playerId: a.id, stake: 20 });
    store.flush();
    const recovered = new AccountStore(path);
    assert.equal(recovered.accounts.get(bettor.id)!.gold, 100);
    assert.equal(recovered.accounts.get(bettor.id)!.arenaBets![0].status, 'refunded');
    recovered.flush();
    assert.equal(new AccountStore(path).accounts.get(bettor.id)!.gold, 100);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('closing an empty arena returns its spectators and refunds the last outstanding bet', async () => {
  const { manager, accounts: [a, b, bettor], matchId } = await setup();
  manager.bettingAction(bettor.id, { kind: 'bet', matchId, playerId: a.id, stake: 10 });
  manager.bettingAction(bettor.id, { kind: 'watch', matchId });
  manager.disconnect(a.id, true); manager.disconnect(b.id, true);
  assert.equal(manager.rooms.has(matchId), false);
  assert.equal(manager.stateFor(bettor.id).mode, 'world');
  assert.equal(bettor.arenaBets![0].status, 'refunded');
  assert.equal(bettor.gold, 100);
});

test('any player can watch an arena after bets close, without placing a wager', async () => {
  const { manager, accounts: [, , viewer], matchId } = await setup();
  advance(manager, 10.1);
  assert.equal(manager.rooms.get(matchId)!.market!.phase, 'live');
  manager.bettingAction(viewer.id, { kind: 'watch', matchId });
  assert.equal(manager.snapshotFor(viewer.id)!.betting!.spectating, matchId);
  assert.equal(viewer.arenaBets?.length ?? 0, 0);
  manager.bettingAction(viewer.id, { kind: 'exit' });
  assert.equal(manager.stateFor(viewer.id).mode, 'world');
});

test('10,000 historical bets stay persisted, but snapshots send only last 10 results plus active bets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-bet-history-'));
  try {
    const store = new AccountStore(join(directory, 'accounts.json'));
    const { manager, accounts: [a, , bettor], matchId } = await setup(store);
    bettor.arenaBets = Array.from({ length: 10000 }, (_, i) => ({ id: `history:${i}`, matchId: `old:${i}`, playerId: a.id, playerName: a.name, stake: 1, odds: 1.89, payout: 0, status: 'lost' as const, placedAt: i }));
    manager.bettingAction(bettor.id, { kind: 'bet', matchId, playerId: a.id, stake: 10 });
    const bets = manager.snapshotFor(bettor.id)!.betting!.bets;
    assert.equal(bets.length, 11); assert.equal(bets[0].status, 'active');
    assert.deepEqual(bets.slice(1).map(b => b.id), Array.from({ length: 10 }, (_, i) => `history:${9999 - i}`));
    assert.equal(bettor.arenaBets.length, 10001);
    store.flush();
    const restored = new AccountStore(store.path).accounts.get(bettor.id)!;
    assert.equal(restored.arenaBets!.length, 10001);
    assert.equal(restored.arenaBets![10000].status, 'refunded');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('confirmed wins always notify once, but celebration is disabled during combat', async () => {
  for (const combat of [false, true]) {
    const { manager, accounts: [a, b, bettor], matchId } = await setup();
    manager.bettingAction(bettor.id, { kind: 'bet', matchId, playerId: a.id, stake: 10 });
    advance(manager, 10.1);
    if (combat) manager.global.connections.get(bettor.id)!.combatUntil = manager.global.now + 10000;
    manager.rooms.get(matchId)!.simulation.players.get(b.id)!.hp = 0;
    manager.step(.1);
    assert.deepEqual(manager.takeBetWins(bettor.id), [{ id: bettor.arenaBets![0].id, amount: 18, celebrate: !combat }]);
    assert.deepEqual(manager.takeBetWins(bettor.id), []);
  }
});
