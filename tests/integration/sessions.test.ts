import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../shared/config';
import type { ServerMessage } from '../../shared/types';

test('real transport: room handshake, reconnect, duplicate session ownership and voluntary leave', { timeout: 30_000 }, async () => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-sessions-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
    cwd: resolve('.'), windowsHide: true,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: join(directory, 'accounts.json'), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ended = once(child, 'close');
  const sockets: WebSocket[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Test server startup timeout')), 10_000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('Riftlands:')) { clearTimeout(timeout); resolve(); } });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test server exited: ${code}`)); });
    });
    async function client() {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      sockets.push(ws);
      const messages: ServerMessage[] = [];
      ws.on('message', raw => messages.push(JSON.parse(String(raw))));
      await once(ws, 'open');
      async function next<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
        const existing = messages.findIndex(message => message.type === type);
        if (existing >= 0) return messages.splice(existing, 1)[0] as Extract<ServerMessage, { type: T }>;
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { ws.off('message', listener); reject(new Error(`Missing ${type}`)); }, 5000);
          const listener = () => {
            const index = messages.findIndex(message => message.type === type);
            if (index >= 0) { clearTimeout(timeout); ws.off('message', listener); resolve(messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>); }
          };
          ws.on('message', listener);
        });
      }
      return { ws, next, messages, send: (message: unknown) => ws.send(JSON.stringify(message)) };
    }
    const first = await client();
    first.send({ type: 'hello', mode: 'register', name: 'TransportTester', password: 'test-password', classId: 'mage', protocol: PROTOCOL_VERSION });
    const welcome = await first.next('welcome');
    const room = (await first.next('room')).room;
    assert.equal(room.mode, 'world');
    assert.equal((await first.next('snapshot')).self.id, welcome.playerId);
    first.ws.terminate();
    await once(first.ws, 'close');

    const resumed = await client();
    resumed.send({ type: 'hello', token: welcome.token, classId: 'mage', protocol: PROTOCOL_VERSION });
    assert.equal((await resumed.next('welcome')).playerId, welcome.playerId);
    const resumedRoom = (await resumed.next('room')).room;
    assert.ok(resumedRoom.epoch > room.epoch);

    const replacement = await client();
    replacement.send({ type: 'hello', token: welcome.token, classId: 'mage', protocol: PROTOCOL_VERSION });
    await replacement.next('welcome');
    const currentRoom = (await replacement.next('room')).room;
    const superseded = await resumed.next('error');
    assert.equal(superseded.fatal, true);
    assert.notEqual(superseded.authExpired, true);
    replacement.messages.length = 0;
    replacement.send({ type: 'input', roomId: currentRoom.id, epoch: currentRoom.epoch, input: { seq: 1, dx: 1, dy: 0, aim: 0 } });
    let snapshot = await replacement.next('snapshot');
    for (let i = 0; snapshot.ack !== 1 && i < 10; i++) snapshot = await replacement.next('snapshot');
    assert.equal(snapshot.ack, 1);
    assert.equal(snapshot.online, 1);
    replacement.send({ type: 'input', roomId: room.id, epoch: room.epoch, input: { seq: 2, dx: 1, dy: 0, aim: 0 } });
    replacement.messages.length = 0;
    assert.equal((await replacement.next('snapshot')).ack, 1);
    replacement.send({ type: 'leave' });
    await once(replacement.ws, 'close');

    const last = await client();
    last.send({ type: 'hello', token: welcome.token, classId: 'mage', protocol: PROTOCOL_VERSION });
    assert.equal((await last.next('welcome')).playerId, welcome.playerId);
    assert.equal((await last.next('snapshot')).online, 1);
  } finally {
    for (const socket of sockets) socket.terminate();
    child.kill();
    await ended;
    rmSync(directory, { recursive: true, force: true });
  }
});
