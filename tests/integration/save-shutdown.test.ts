import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../shared/config';
import { SnapshotObserver } from '../fixtures/snapshot-observer';
import { AccountStore } from '../../server/store';

for (const failWrite of [false, true]) test(failWrite ? 'real server exits with failure after a disk error and preserves the previous account file' : 'real server drains the final checkpoint before exit and releases its data lease', { timeout: 30_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-save-shutdown-')), path = join(directory, 'accounts.json');
  if (failWrite) new AccountStore(path).register('KeptAccount', 'test-password');
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(done => probe.close(() => done()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/shutdown-server.ts', '--production'], {
    cwd: resolve('.'), windowsHide: true,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: path, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const ended = once(child, 'close'); let socket: WebSocket | undefined, stderr = '';
  child.stderr!.on('data', data => { stderr += String(data); });
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timeout: ${stderr}`)), 10_000);
      child.stdout!.on('data', data => { if (String(data).includes('Riftlands:')) { clearTimeout(timer); done(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}: ${stderr}`)); });
    });
    if (failWrite) mkdirSync(`${path}.tmp`); // Force EISDIR without platform-specific permissions.
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const observer = new SnapshotObserver();
    const snapshot = failWrite ? undefined : new Promise<string>((done, reject) => {
      socket!.on('message', raw => {
        const message = observer.read(String(raw));
        if (message.type === 'snapshot') done(message.self.id);
        if (message.type === 'error') reject(new Error(message.message));
      });
    });
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'hello', mode: 'register', name: 'FinalCheckpoint', password: 'test-password', classId: 'mage', protocol: PROTOCOL_VERSION }));
    if (failWrite) {
      const [code] = await ended;
      assert.equal(code, 1); assert.match(stderr, /Persistenza non disponibile/);
      assert.equal(existsSync(`${path}.lock`), false);
      const accounts = JSON.parse(readFileSync(path, 'utf8')).accounts;
      assert.equal(accounts.length, 1); assert.equal(accounts[0].name, 'KeptAccount');
      return;
    }
    const id = await snapshot!;
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).accounts[0].body, undefined, 'periodic checkpoint has not run yet');
    child.send('shutdown');
    const [code] = await ended;
    assert.equal(code, 0, stderr); assert.equal(existsSync(`${path}.lock`), false); assert.equal(existsSync(`${path}.tmp`), false);
    const restored = new AccountStore(path).accounts.get(id)!;
    assert.equal(restored.body!.id, id); assert.equal(restored.body!.classId, 'mage');
    assert.equal(restored.body!.hp, restored.body!.maxHp); assert.ok(Number.isFinite(restored.body!.x));
    assert.equal(stderr, '');
  } finally {
    socket?.terminate(); if (child.exitCode === null && child.signalCode === null) child.kill();
    await ended; rmSync(directory, { recursive: true, force: true });
  }
});
