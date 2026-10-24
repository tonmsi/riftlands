import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { chromium, expect } from '@playwright/test';
import { PROTOCOL_VERSION, TILE_SIZE } from '../../shared/config';
import { newWorldDocument } from '../../shared/world-schema';
import { INSTALLED_DUNGEON_DEFINITIONS } from '../../shared/dungeons';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { SnapshotObserver } from '../fixtures/snapshot-observer';
import { AccountStore } from '../../server/store';
import { RoomManager } from '../../server/rooms';
import { WORLD_DOCUMENT } from '../../shared/world-content';

test('Studio publishes to the running game, clients receive one coherent revision, and production boots from the runtime map', { timeout: 90_000 }, async () => {
  const root = resolve('.'); await mkdir(join(root, '.tmp'), { recursive: true });
  const directory = await mkdtemp(join(root, '.tmp', 'riftlands-publish-'));
  const documentPath = join(directory, 'world.json'), dataPath = join(directory, 'accounts.json');
  const document = newWorldDocument();
  document.assets = structuredClone(WORLD_DOCUMENT.assets);
  for (const asset of document.assets) asset.generation.enabled = false;
  document.spawn = { x: 8, y: 8 };
  document.dungeons = INSTALLED_DUNGEON_DEFINITIONS.map(d => ({ dungeonId: d.id, x: 0, y: 0, enabled: false }));
  for (let y = -5; y < 20; y++) for (let x = -5; x < 20; x++) document.tiles.push({ x, y, terrain: 'grass' });
  await writeFile(documentPath, JSON.stringify(document));
  const store = new AccountStore(dataPath), fixture = new RoomManager(store, document.seed, Date.now(), document);
  for (const [name, x] of [['LiveAlice', 3.5], ['LiveBob', 10.5]] as const) {
    const { account } = store.register(name, 'test-password');
    Object.assign(fixture.connect(account, 'mage'), { x: x * TILE_SIZE, y: 3.5 * TILE_SIZE });
  }
  fixture.checkpoint(); store.flush();
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port; await new Promise<void>(done => probe.close(() => done()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/shutdown-server.ts', '--production'], {
    cwd: root, windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: dataPath, WORLD_FILE: documentPath, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  const ended = once(child, 'close'), sockets: WebSocket[] = []; let stderr = '';
  child.stderr!.on('data', data => { stderr += String(data); });
  let studio: Awaited<ReturnType<typeof startWorldStudio>> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup timeout: ${stderr}`)), 15_000);
      child.stdout!.on('data', data => { if (String(data).includes('Riftlands:')) { clearTimeout(timer); done(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Exit ${code}: ${stderr}`)); });
    });
    const url = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${url}/__world/publish`, { method: 'POST', body: '{}' }).catch(error => { throw new Error(`${error}: ${JSON.stringify(error.cause)}; server: ${stderr}`); })).status, 403);
    async function client(name: string) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(ws);
      const observer = new SnapshotObserver(), messages: any[] = [];
      ws.on('message', raw => {
        const packet = JSON.parse(String(raw));
        messages.push({ ...observer.read(String(raw)), packetEpoch: packet.room?.epoch });
      }); await once(ws, 'open');
      const next = async (type: string, predicate = (_: any) => true) => {
        const end = Date.now() + 10_000;
        while (Date.now() < end) {
          const index = messages.findIndex(m => m.type === type && predicate(m));
          if (index >= 0) return messages.splice(index, 1)[0];
          await new Promise(done => setTimeout(done, 15));
        }
        throw new Error(`Timeout waiting for ${type}: ${stderr}`);
      };
      ws.send(JSON.stringify({ type: 'hello', mode: 'login', name, password: 'test-password', classId: 'mage', protocol: PROTOCOL_VERSION }));
      await next('world'); const welcome = await next('welcome'), room = (await next('room')).room, initial = await next('snapshot');
      return { ws, next, welcome, room, initial, messages };
    }
    const alice = await client('LiveAlice'), bob = await client('LiveBob');
    studio = await startWorldStudio({ root, port: 0, documentPath, dungeonPath: join(root, 'shared/custom-dungeons.json'), dataPath });
    const origin = new URL(studio.url).origin;
    const project = await (await fetch(`${origin}/__world/project`)).json();
    const modified = structuredClone(document); modified.spawn = { x: 12, y: 12 };
    modified.tiles.find(t => t.x === 3 && t.y === 3)!.terrain = 'rock';
    const publish = (doc: unknown, revision: string) => fetch(`${origin}/__world/project`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'x-world-token': project.token }, body: JSON.stringify({ document: doc, revision }) });
    const response = await publish(modified, project.revision), result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.live, true);
    const update = await alice.next('world'); assert.equal(update.revision, 2);
    assert.equal(update.relocated, true);
    assert.equal((await bob.next('world')).relocated, undefined);
    assert.deepEqual(update.document.spawn, modified.spawn);
    for (const c of [alice, bob]) {
      const room = c === alice ? (await c.next('room')).room : c.room;
      if (c === alice) assert.ok(room.epoch > c.room.epoch);
      else assert.equal(c.messages.filter(m => m.type === 'room').length, 0, 'unchanged player must not receive a room reset');
      const snapshot = await c.next('snapshot', s => s.packetEpoch === room.epoch);
      assert.equal(snapshot.self.x, c === alice ? 12 * TILE_SIZE : c.initial.self.x);
      assert.equal(snapshot.self.y, c === alice ? 12 * TILE_SIZE : c.initial.self.y);
      c.ws.send(JSON.stringify({ type: 'input', roomId: room.id, epoch: room.epoch, input: { seq: 1, dx: 0, dy: 0, aim: 0 } }));
      await c.next('snapshot', s => s.ack === 1);
    }
    assert.equal((await publish(document, project.revision)).status, 400, 'stale publication is rejected');
    assert.deepEqual(JSON.parse(await readFile(documentPath, 'utf8')).spawn, modified.spawn);
    assert.deepEqual((await (await fetch(`${url}/api/world`)).json()).spawn, modified.spawn);
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
    for (const pageUrl of [url, studio.url]) {
      const page = await browser.newPage(), errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pageUrl);
      await page.locator(pageUrl === url ? '.rift-app' : '#apply-world').waitFor({ timeout: 20_000 });
      assert.deepEqual(await page.evaluate(() => (globalThis as any).__RIFTLANDS_WORLD__.spawn), modified.spawn);
      assert.deepEqual(errors, []); await page.close();
    }
    const user = await (await fetch(`${url}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'register', name: 'LiveBrowser', password: 'test-password' }) })).json();
    const context = await browser.newContext();
    await context.addInitScript(({ token, account }) => {
      localStorage.setItem('riftlands.jwt', token); localStorage.setItem('riftlands.profile', JSON.stringify(account));
    }, user);
    const page = await context.newPage(), browserErrors: string[] = [];
    let latest: any, revision = 0, roomCount = 0;
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('websocket', socket => {
      const observer = new SnapshotObserver();
      socket.on('framereceived', frame => {
        const message = observer.read(String(frame.payload));
        if (message.type === 'snapshot') latest = message;
        if (message.type === 'world') revision = message.revision;
        if (message.type === 'room') roomCount++;
      });
    });
    await page.goto(url); await page.locator('[data-ref="join"]').click();
    await expect(page.locator('[data-ref="world-entrance"]')).toBeHidden();
    await expect.poll(() => latest?.self.x).toBeDefined();
    const nextDocument = structuredClone(modified); nextDocument.spawn = { x: 16, y: 16 };
    const tx = Math.floor(latest.self.x / TILE_SIZE), ty = Math.floor(latest.self.y / TILE_SIZE);
    for (const tile of nextDocument.tiles) if (Math.abs(tile.x - tx) <= 1 && Math.abs(tile.y - ty) <= 1) tile.terrain = 'rock';
    const second = await publish(nextDocument, result.revision), secondResult = await second.json(); assert.equal(second.status, 200, JSON.stringify(secondResult));
    await expect.poll(() => revision).toBe(3);
    await expect.poll(() => latest ? Math.hypot(latest.self.x - 16 * TILE_SIZE, latest.self.y - 16 * TILE_SIZE) : Infinity).toBeLessThan(45);
    const movementStart = { x: latest.self.x, y: latest.self.y };
    await page.locator('.world-canvas').focus(); await page.keyboard.down('KeyW');
    await expect.poll(() => latest ? Math.hypot(latest.self.x - movementStart.x, latest.self.y - movementStart.y) : 0).toBeGreaterThan(20);
    const beforePublication = { x: latest.self.x, y: latest.self.y, rooms: roomCount };
    const cosmetic = structuredClone(nextDocument); cosmetic.assets[0].name = 'Aggiornamento senza spostare il giocatore';
    const cosmeticResult = await publish(cosmetic, secondResult.revision); assert.equal(cosmeticResult.status, 200, await cosmeticResult.text());
    await expect.poll(() => revision).toBe(4);
    await expect.poll(() => latest ? Math.hypot(latest.self.x - beforePublication.x, latest.self.y - beforePublication.y) : 0).toBeGreaterThan(70);
    assert.equal(roomCount, beforePublication.rooms, 'the client keeps held movement keys and its room when its position is unchanged');
    await page.keyboard.up('KeyW'); assert.deepEqual(browserErrors, []);
    await context.close();
    const editor = await browser.newPage({ viewport: { width: 1640, height: 1100 } });
    await editor.goto(studio.url); await expect(editor.locator('#status')).toContainText('World Studio pronto');
    await editor.locator('#asset-list button').first().click();
    for (const name of ['Prima modifica live', 'Seconda modifica live']) {
      await editor.locator('#asset-name').fill(name); await editor.locator('#asset-update').click();
      await editor.locator('#apply-world').click();
      await expect(editor.locator('#status')).toContainText('Mappa pubblicata sul gioco attivo');
      assert.ok(JSON.parse(await readFile(documentPath, 'utf8')).assets.some((a: { name: string }) => a.name === name));
    }
    await editor.close();
  } finally {
    for (const ws of sockets) ws.terminate();
    await browser?.close(); await studio?.close();
    if (child.exitCode === null && child.connected) child.send('shutdown');
    if (child.exitCode === null) {
      const timeout = setTimeout(() => child.kill(), 5000);
      await ended; clearTimeout(timeout);
    }
    await rm(directory, { recursive: true, force: true });
  }
});
