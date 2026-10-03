import test from 'node:test';
import assert from 'node:assert/strict';
import { GameConnection } from '../client/net';
import { SnapshotEncoder } from '../shared/snapshot-stream';
import type { Actor, Snapshot } from '../shared/types';

test('registration reconnects with the issued token and discards stale room ownership', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1; static CLOSING = 2;
    readyState = 1; bufferedAmount = 0; sent: any[] = [];
    onopen = () => {}; onmessage = (_: { data: string }) => {}; onclose = (_: { code: number; reason: string }) => {};
    constructor() { sockets.push(this); }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
  }
  const descriptors = new Map(['WebSocket', 'location', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'http:', host: 'localhost' } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {} } });
  const snapshots: Snapshot[] = [];
  const connection = new GameConnection({ message: message => { if (message.type === 'snapshot') snapshots.push(message); }, status: () => {}, reset: () => {} });
  try {
    connection.joinWithCredentials('register', 'Alice', 'secret', 'mage');
    sockets[0].onopen();
    sockets[0].onmessage({ data: JSON.stringify({ type: 'welcome', token: 'issued-token', time: 0 }) });
    assert.ok(sockets[0].sent.some(message => message.type === 'ping'), 'measure latency immediately on welcome');
    sockets[0].onmessage({ data: JSON.stringify({ type: 'pong', time: 1000, at: performance.now() - 300 }) });
    assert.ok(connection.serverTime() >= 1150 && connection.serverTime() < 1180, 'first pong establishes the clock without slow convergence');
    sockets[0].onmessage({ data: JSON.stringify({ type: 'room', room: { id: 'world', epoch: 1 } }) });
    const self: Actor = { id: 'self', name: 'Alice', kind: 'player', classId: 'mage', x: 0, y: 0, radius: 15, hp: 110, maxHp: 110, resource: 120, maxResource: 120, aim: 0, speed: 190, level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
    const frame: Snapshot = { type: 'snapshot', tick: 1, time: 1000, ack: 0, self, actors: [self, { ...self, id: 'other', name: 'Bob' }], projectiles: [], pickups: [], events: [], online: 2, activeChunks: 1 };
    const encoder = new SnapshotEncoder();
    const deliver = (socket: FakeSocket, stream: SnapshotEncoder, identity: { id: string; epoch: number }) => {
      const prepared = stream.prepare(frame, identity);
      socket.onmessage({ data: JSON.stringify(prepared.packet) }); prepared.commit();
    };
    deliver(sockets[0], encoder, { id: 'world', epoch: 1 });
    frame.actors[1].x = 40; frame.time += 67;
    deliver(sockets[0], encoder, { id: 'world', epoch: 1 });
    assert.equal(snapshots.at(-1)!.actors[1].x, 40);
    assert.equal(snapshots[0].actors[1].x, 0);
    assert.equal(connection.send({ type: 'interaction', command: { kind: 'talk', targetId: 'fisher' } }), true);
    assert.deepEqual(sockets[0].sent.at(-1), { type: 'interaction', command: { kind: 'talk', targetId: 'fisher' }, roomId: 'world', epoch: 1 });
    sockets[0].onclose({ code: 1006, reason: '' });
    t.mock.timers.tick(1000);
    sockets[1].onopen();
    assert.equal(sockets[1].sent[0].token, 'issued-token');
    assert.equal(sockets[1].sent[0].password, undefined);
    assert.equal(sockets[1].sent[0].mode, undefined);
    sockets[1].onmessage({ data: JSON.stringify({ type: 'welcome', token: 'issued-token', time: 0 }) });
    assert.equal(connection.send({ type: 'input', input: { seq: 1, dx: 1, dy: 0, aim: 0 } }), false);
    assert.equal(connection.send({ type: 'interaction', command: { kind: 'talk', targetId: 'fisher' } }), false);
    sockets[1].onmessage({ data: JSON.stringify({ type: 'room', room: { id: 'world', epoch: 2 } }) });
    deliver(sockets[1], new SnapshotEncoder(), { id: 'world', epoch: 2 });
    assert.equal(snapshots.at(-1)!.actors[1].x, 40, 'reconnect reconstructs a fresh stream');
    sockets[1].onmessage({ data: JSON.stringify({ type: 'room', room: { id: 'arena', epoch: 3 } }) });
    frame.actors = [frame.self];
    deliver(sockets[1], encoder, { id: 'arena', epoch: 3 });
    assert.equal(snapshots.at(-1)!.actors.length, 1, 'room changes discard previous actors');
  } finally {
    connection.leave();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
