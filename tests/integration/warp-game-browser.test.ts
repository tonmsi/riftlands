import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { WebSocketServer, type WebSocket } from 'ws';
import { chromium, expect } from '@playwright/test';
import { AccountStore, publicAccount } from '../../server/store';
import { RoomManager } from '../../server/rooms';
import { INSTALLED_DUNGEON_DEFINITIONS } from '../../shared/dungeons';
import { newWorldDocument } from '../../shared/world-schema';
import { newInterior, warpPosition } from '../../shared/warps';
import { SnapshotEncoder } from '../../shared/snapshot-stream';
import { SnapshotObserver } from '../fixtures/snapshot-observer';
import type { Snapshot, RoomState } from '../../shared/types';

test('real game changes interior maps, reconnects indoors and still switches to arena rooms', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-warp-game-'));
  const store = new AccountStore(join(directory, 'accounts.json')), user = store.register('WarpTraveller', 'test-password');
  const project = newWorldDocument(); project.spawn = { x: 10, y: 10 };
  project.dungeons = INSTALLED_DUNGEON_DEFINITIONS.map(d => ({ dungeonId: d.id, x: 0, y: 0, enabled: false }));
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) project.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  project.zones = [{ id: 'safe', name: 'Esterno', priority: 1, shape: { kind: 'rect', x: 0, y: 0, width: 24, height: 24 }, pvp: false, generateAssets: false,
    npcs: { density: 0, maxPerChunk: 0, weights: { slime: 0, wisp: 0, sentinel: 0 } } }];
  project.interiors = [newInterior('house', 'Locanda del viandante')];
  project.warps = [
    { id: 'enter', name: 'Entra', from: 'world', to: 'house', entry: { x: 2, y: 2 }, arrival: { x: 8, y: 8 }, activation: 'walk' },
    { id: 'exit', name: 'Esci dalla locanda', from: 'house', to: 'world', entry: { x: 8, y: 11 }, arrival: { x: 2, y: 5 }, activation: 'interact' },
  ];
  const rooms = new RoomManager(store, project.seed, Date.now(), project);
  const httpServer = createHttpServer((request, response) => { server.middlewares(request, response); });
  const server = await createServer({ appType: 'mpa', server: { middlewareMode: true, hmr: { server: httpServer }, watch: null }, logLevel: 'error', plugins: [{ name: 'warp-fixture', enforce: 'pre',
    transform(_source, id) { if (id.replaceAll('\\', '/').endsWith('/shared/world-content.ts')) return `export const WORLD_DOCUMENT = ${JSON.stringify(project)};`; } }] });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, timer: ReturnType<typeof setInterval> | undefined, wsServer: WebSocketServer | undefined;
  const peers = new Map<WebSocket, { epoch?: number; encoder: SnapshotEncoder; joined: boolean }>();
  try {
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(httpServer.address() as { port: number }).port}`;
    wsServer = new WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (request, socket, head) => { if (request.url === '/ws') wsServer!.handleUpgrade(request, socket, head, ws => wsServer!.emit('connection', ws, request)); });
    wsServer.on('connection', ws => {
      const peer = { encoder: new SnapshotEncoder(), joined: false, epoch: undefined as number | undefined }; peers.set(ws, peer);
      ws.on('message', data => {
        const command = JSON.parse(String(data));
        if (command.type === 'hello') {
          rooms.connect(user.account, command.classId); peer.joined = true;
          ws.send(JSON.stringify({ type: 'welcome', token: user.token, account: publicAccount(user.account), playerId: user.account.id,
            seed: project.seed, tickRate: 30, time: rooms.global.now, social: rooms.socialFor(user.account.id) }));
        } else if (command.type === 'input') rooms.enqueueInput(user.account.id, command.input, command.roomId, command.epoch);
        else if (command.type === 'interaction') rooms.interact(user.account.id, command.command, command.roomId, command.epoch);
        else if (command.type === 'ping') ws.send(JSON.stringify({ type: 'pong', at: command.at, time: rooms.global.now }));
      });
      ws.on('close', () => { peers.delete(ws); if (peer.joined) rooms.disconnect(user.account.id); });
    });
    timer = setInterval(() => {
      rooms.step(.05);
      for (const [ws, peer] of peers) if (peer.joined && ws.readyState === 1) {
        const transition = rooms.takeWarpTransition(user.account.id); if (transition) ws.send(JSON.stringify(transition));
        const state = rooms.stateFor(user.account.id);
        if (peer.epoch !== state.epoch) { peer.epoch = state.epoch; ws.send(JSON.stringify({ type: 'room', room: state })); }
        const snapshot = rooms.snapshotFor(user.account.id);
        if (snapshot) { const prepared = peer.encoder.prepare(snapshot, state); ws.send(JSON.stringify(prepared.packet)); prepared.commit(); }
      }
    }, 50);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(({ token, profile }) => { localStorage.setItem('riftlands.jwt', token); localStorage.setItem('riftlands.profile', JSON.stringify(profile)); }, { token: user.token, profile: publicAccount(user.account) });
    const page = await context.newPage(), errors: string[] = []; let latest: Snapshot | undefined, room: RoomState | undefined;
    const pendingRequests = new Set<string>();
    page.on('request', request => pendingRequests.add(request.url()));
    page.on('requestfinished', request => pendingRequests.delete(request.url()));
    page.on('requestfailed', request => pendingRequests.delete(request.url()));
    page.on('pageerror', e => errors.push(e.message));
    page.on('websocket', socket => { const observer = new SnapshotObserver(); socket.on('framereceived', frame => {
      const message = observer.read(String(frame.payload)); if (message.type === 'snapshot') latest = message; if (message.type === 'room') room = message.room;
    }); });
    await page.route('**/api/lobby*', route => route.fulfill({ json: { account: publicAccount(user.account), friends: [], leaderboard: [] } }));
    await page.route('**/api/actor-catalog', route => route.fulfill({ status: 404 }));
    try { await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 12_000 }); }
    catch (error) { console.log('Richieste pendenti:', [...pendingRequests], 'Errori pagina:', errors); throw error; }
    await page.locator('[data-ref="join"]').click({ timeout: 15_000 });
    await expect(page.locator('.game-hud')).toBeVisible(); await expect.poll(() => latest?.self.id).toBe(user.account.id);
    Object.assign(rooms.global.players.get(user.account.id)!, warpPosition(project.warps[0].entry));
    await expect(page.locator('.warp-veil')).toHaveClass('warp-veil visible');
    await expect.poll(() => room?.mapId).toBe('house'); await expect(page.locator('.warp-veil')).toHaveClass('warp-veil');
    await expect.poll(() => latest?.self.x).toBe(warpPosition(project.warps[0].arrival).x);
    assert.equal(rooms.global.players.has(user.account.id), false);
    const oldEpoch = room!.epoch; for (const ws of peers.keys()) ws.terminate();
    await expect.poll(() => room?.epoch ?? 0).toBeGreaterThan(oldEpoch); assert.equal(room!.mapId, 'house');
    Object.assign(rooms.simulationFor(user.account.id).players.get(user.account.id)!, warpPosition(project.warps[1].entry));
    await expect(page.locator('.warp-enter')).toBeVisible(); await page.locator('.warp-enter').click();
    await expect.poll(() => room?.id).toBe('world'); await expect(page.locator('.warp-veil')).toHaveClass('warp-veil');
    await expect.poll(() => latest?.self.y).toBe(warpPosition(project.warps[1].arrival).y);
    const opponent = store.register('WarpOpponent', 'test-password').account;
    rooms.connect(opponent, 'mage');
    for (const id of [user.account.id, opponent.id]) rooms.global.connections.get(id)!.combatAt = rooms.global.now - 11_000;
    const matchId = await rooms.createMatch('arena', [[user.account.id], [opponent.id]], 60);
    await expect.poll(() => room?.mode).toBe('arena'); await expect.poll(() => room?.id).toBe(matchId);
    await expect(page.locator('.warp-enter')).toBeHidden();
    await expect.poll(() => latest?.self.teamId?.startsWith(matchId)).toBe(true);
    rooms.closeMatch(matchId); await expect.poll(() => room?.id).toBe('world');
    assert.deepEqual(errors, []);
  } finally {
    if (timer) clearInterval(timer); await browser?.close();
    for (const ws of wsServer?.clients ?? []) ws.terminate();
    if (wsServer) await new Promise<void>(resolve => wsServer!.close(() => resolve()));
    await server.close(); await new Promise<void>(resolve => httpServer.close(() => resolve())); await rm(directory, { recursive: true, force: true });
  }
});
