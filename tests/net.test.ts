import test from 'node:test';
import assert from 'node:assert/strict';
import { GameConnection } from '../client/net';

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
  const connection = new GameConnection({ message: () => {}, status: () => {}, reset: () => {} });
  try {
    connection.joinWithCredentials('register', 'Alice', 'secret', 'mage');
    sockets[0].onopen();
    sockets[0].onmessage({ data: JSON.stringify({ type: 'welcome', token: 'issued-token', time: 0 }) });
    sockets[0].onmessage({ data: JSON.stringify({ type: 'room', room: { id: 'world', epoch: 1 } }) });
    sockets[0].onclose({ code: 1006, reason: '' });
    t.mock.timers.tick(1000);
    sockets[1].onopen();
    assert.equal(sockets[1].sent[0].token, 'issued-token');
    assert.equal(sockets[1].sent[0].password, undefined);
    assert.equal(sockets[1].sent[0].mode, undefined);
    sockets[1].onmessage({ data: JSON.stringify({ type: 'welcome', token: 'issued-token', time: 0 }) });
    assert.equal(connection.send({ type: 'input', input: { seq: 1, dx: 1, dy: 0, aim: 0 } }), false);
  } finally {
    connection.leave();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
