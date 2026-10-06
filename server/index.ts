import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer } from 'ws';
import { CLASSES, DT, PROTOCOL_VERSION, SNAPSHOT_RATE, TICK_RATE, WORLD_SEED } from '../shared/config';
import type { ClassId, ClientMessage, ServerMessage } from '../shared/types';
import { Account, AccountStore, publicAccount, characterFor, saveCharacterBuild } from './store';
import { RoomManager } from './rooms';
import { AuthBudget } from './auth-budget';
import { NetworkMetrics } from './metrics';
import { acquireDataLease } from './data-lease';
import { SnapshotEncoder, type SnapshotPacket } from '../shared/snapshot-stream';
import { newNarrativeProgress } from '../shared/narrative';
import { OrderedSaveWriter } from './save-writer';
import { ACTOR_CATALOG } from '../shared/actor-catalog';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve essere tra 1 e 65535.');
const dataPath = process.env.DATA_FILE ? resolve(process.env.DATA_FILE) : resolve(ROOT, 'data/accounts.json');
const releaseData = acquireDataLease(dataPath);
process.once('exit', releaseData);
const saves = new OrderedSaveWriter();
const store = new AccountStore(dataPath, saves);
await store.drain(); // Finish migrations before exposing the server or world.
const rooms = new RoomManager(store, WORLD_SEED);
const simulation = rooms.global;
let healthy = true;
let closing = false;
const authLifetime = new AbortController();
let tickCostMs = 0;
const metrics = new NetworkMetrics();
const dist = resolve(ROOT, 'dist');
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const server = createServer((request, response) => {
  const path = (request.url ?? '/').split('?')[0];
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (path === '/api/actor-catalog' && request.method === 'GET') {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ catalog: ACTOR_CATALOG })); return;
  }
  if (path === '/api/build' && request.method === 'POST') {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
    if (!healthy || closing) { response.writeHead(503); response.end(); return; }
    try { if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) throw new Error(); }
    catch { response.writeHead(403); response.end(JSON.stringify({ error: 'Origine non consentita.' })); return; }
    const identity = store.verifyJwt((request.headers.authorization ?? '').replace(/^Bearer /, ''));
    const account = identity ? store.accounts.get(identity.sub) : undefined;
    if (!account) { response.writeHead(401); response.end(JSON.stringify({ error: 'Accedi di nuovo.' })); return; }
    let body = '', size = 0;
    request.setTimeout(10_000, () => request.destroy()); request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > 4096) { response.writeHead(413); response.end(); request.destroy(); return; }
      body += chunk;
    });
    request.on('end', () => { if (response.writableEnded) return; void (async () => {
      try {
        const input = JSON.parse(body);
        if (!input || typeof input.classId !== 'string' || !Object.hasOwn(CLASSES, input.classId)) throw new Error('Personaggio non valido.');
        const live = simulation.players.get(account.id), connection = simulation.connections.get(account.id);
        if (byAccount.has(account.id) || simulation.awayPlayers.has(account.id) || live && (live.hp <= 0 || simulation.now - (connection?.combatAt ?? 0) < 10_000)) throw new Error('Cambia build dal menu, quando sei fuori combattimento.');
        const classId = input.classId as ClassId;
        const cost = saveCharacterBuild(account, classId, input.loadout);
        const loadout = characterFor(account, classId).loadout;
        if (live?.classId === classId) {
          live.loadout = { ...loadout };
          const until = Math.max(live.cooldowns.q, live.cooldowns.e, live.cooldowns.r);
          live.cooldowns.q = live.cooldowns.e = live.cooldowns.r = until;
        }
        if (account.body?.classId === classId) {
          account.body.loadout = { ...loadout };
          const until = Math.max(account.body.cooldowns.q, account.body.cooldowns.e, account.body.cooldowns.r);
          account.body.cooldowns.q = account.body.cooldowns.e = account.body.cooldowns.r = until;
        }
        store.touch(); store.flush(); await store.drain();
        if (!response.destroyed) response.end(JSON.stringify({ account: publicAccount(account), cost }));
      } catch (error) {
        if (!response.destroyed) { response.writeHead(400); response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Configurazione non valida.' })); }
      }
    })(); });
    return;
  }
  if (path === '/api/auth' && request.method === 'POST') {
    if (!healthy || closing) { response.writeHead(503); response.end(); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    const origin = request.headers.origin;
    try {
      if (origin && new URL(origin).host !== request.headers.host) throw new Error();
    } catch { response.writeHead(403); response.end(JSON.stringify({ error: 'Origine non consentita.' })); return; }
    const ip = request.socket.remoteAddress ?? 'unknown';
    let body = '', size = 0;
    request.setTimeout(10_000, () => request.destroy());
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > 4096) { response.writeHead(413); response.end(JSON.stringify({ error: 'Richiesta troppo grande.' })); request.destroy(); return; }
      body += chunk;
    });
    request.on('end', () => {
      if (response.writableEnded) return;
      void (async () => {
        let input: { mode?: unknown; name?: unknown; password?: unknown };
        try { input = JSON.parse(body); if (!input || typeof input !== 'object') throw new Error(); }
        catch { response.writeHead(400); response.end(JSON.stringify({ error: 'Dati non validi.' })); return; }
        try {
          const result = await authenticateCredentials(ip, input.mode, input.name, input.password);
          if (response.destroyed) return;
          response.end(JSON.stringify({ token: result.token, account: publicAccount(result.account) }));
        } catch (error) {
          if (response.destroyed) return;
          response.writeHead(400);
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Accesso non riuscito.' }));
        }
      })();
    });
    return;
  }
  if (path === '/api/lobby' && request.method === 'GET') {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    const authorization = request.headers.authorization;
    let account: Account | undefined;
    if (authorization) {
      const identity = store.verifyJwt(authorization.replace(/^Bearer /, ''));
      account = identity ? store.accounts.get(identity.sub) : undefined;
      if (!account) { response.writeHead(401); response.end(JSON.stringify({ error: 'Sessione scaduta. Accedi di nuovo.' })); return; }
    }
    const leaderboard = [...store.accounts.values()].sort((a, b) => b.xp - a.xp || b.kills - a.kills || a.name.localeCompare(b.name)).slice(0, 20)
      .map(({ id, name, xp, kills }) => ({ id, name, xp, kills }));
    const friends = account?.friends.flatMap(id => {
      const friend = store.accounts.get(id);
      return friend ? [{ id, name: friend.name, online: byAccount.has(id) }] : [];
    }) ?? [];
    const selectedClass = new URL(request.url!, 'http://localhost').searchParams.get('classId');
    const narrative = account && selectedClass && Object.hasOwn(CLASSES, selectedClass) ? characterFor(account, selectedClass as ClassId).narrative : account?.narrative;
    response.end(JSON.stringify({ account: account ? publicAccount(account) : null, narrative: narrative ?? newNarrativeProgress(), friends, leaderboard }));
    return;
  }
  if (path === '/health') {
    response.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ok: healthy, online: byAccount.size, worldOnline: simulation.online, matchRooms: rooms.rooms.size, tick: simulation.tick, tickRate: TICK_RATE, snapshotRate: SNAPSHOT_RATE, activeChunks: simulation.activeChunks.size + [...rooms.rooms.values()].reduce((sum, room) => sum + room.simulation.activeChunks.size, 0), npcs: simulation.npcs.size, tickCostMs: Math.round(tickCostMs * 100) / 100, metrics: metrics.read() }));
    return;
  }
  if (!production) {
    if (vite) vite.middlewares(request, response, () => { response.writeHead(404); response.end('Not found'); });
    else { response.writeHead(503); response.end('Server in avvio'); }
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
  let relative: string;
  try { relative = decodeURIComponent(path); } catch { response.writeHead(400); response.end(); return; }
  if (/^\/(actor-assets|world-assets)\/[a-zA-Z0-9_-]+\.(png|svg)$/.test(relative)) {
    const asset = resolve(ROOT, 'public', relative.slice(1));
    if (!existsSync(asset) || !statSync(asset).isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': mime[extname(asset)], 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') response.end(); else createReadStream(asset).on('error', () => response.destroy()).pipe(response);
    return;
  }
  let file = resolve(dist, `.${relative}`);
  if (file !== dist && !file.startsWith(dist + sep)) { response.writeHead(403); response.end(); return; }
  if (file === dist || !extname(file)) file = resolve(dist, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache' });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).on('error', () => response.destroy()).pipe(response);
});

let vite: import('vite').ViteDevServer | undefined;
if (!production) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({ root: ROOT, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
} else if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Build frontend assente. Esegui npm run build prima di npm start.');

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
type Session = { ws: WebSocket; snapshots: SnapshotEncoder; id?: string; authenticating?: boolean; roomEpoch?: number; ip: string; alive: boolean; receivedAt: number; tokens: number; socialTokens: number; interactionTokens: number; badPackets: number; helloDeadline: ReturnType<typeof setTimeout> };
const sessions = new Map<WebSocket, Session>();
const byAccount = new Map<string, Session>();
const ipConnections = new Map<string, number>();
const registrations = new Map<string, { count: number; until: number }>();
const authBudget = new AuthBudget();

async function authenticateCredentials(ip: string, mode: unknown, rawName: unknown, rawPassword: unknown): Promise<{ account: Account; token: string }> {
  if (!healthy || closing) throw new Error('Server in chiusura.');
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  const password = typeof rawPassword === 'string' ? rawPassword : '';
  if (!name || !password) throw new Error('Inserisci sia il nome sia la password.');
  if (name.length > 20 || password.length > 100) throw new Error('Nome o password troppo lunghi.');
  if (mode !== 'register' && mode !== 'login') throw new Error('Modalità di accesso non supportata.');
  const release = authBudget.acquire(ip, performance.now());
  if (!release) throw new Error('Troppi tentativi di accesso. Riprova tra poco.');
  try {
    if (mode === 'register') {
      let entry = registrations.get(ip);
      if (!entry || entry.until < Date.now()) { entry = { count: 0, until: Date.now() + 600_000 }; registrations.set(ip, entry); }
      if (entry.count >= 20) throw new Error('Troppi nuovi personaggi creati di recente. Riprova tra poco.');
      entry.count++;
      return await store.registerAsync(name, password, authLifetime.signal);
    }
    return await store.loginAsync(name, password, authLifetime.signal);
  } finally { release(); }
}

server.on('upgrade', (request, socket, head) => {
  if ((request.url ?? '').split('?')[0] !== '/ws') {
    if (production) socket.destroy();
    return;
  }
  if (!healthy || closing || wss.clients.size >= 150) { socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
  const origin = request.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.host) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    } catch { socket.destroy(); return; }
  }
  const ip = request.socket.remoteAddress ?? 'unknown';
  if ((ipConnections.get(ip) ?? 0) >= 12) { socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
  wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
});

function send(session: Session, message: ServerMessage | SnapshotPacket): boolean {
  if (session.ws.readyState !== WebSocket.OPEN) return false;
  if (session.ws.bufferedAmount > 1024 * 1024) { session.ws.close(1008, 'Connessione troppo lenta'); return false; }
  if (message.type === 'snapshot' && session.ws.bufferedAmount > 0) return false;
  const encoded = JSON.stringify(message);
  session.ws.send(encoded);
  if (message.type === 'snapshot') { metrics.snapshotsSent++; metrics.snapshotBytes += Buffer.byteLength(encoded); }
  return true;
}

function fatal(session: Session, message: string, authExpired = false): void {
  send(session, { type: 'error', message, fatal: true, authExpired });
  session.ws.close(1008, message.slice(0, 70));
}

function socialBroadcast(): void {
  for (const session of sessions.values()) if (session.id && byAccount.get(session.id) === session) send(session, { type: 'social', state: rooms.socialFor(session.id) });
}

function sendSnapshot(session: Session): void {
  // Skip obsolete state before building/copying it. Reliable control messages retain priority.
  if (session.ws.readyState !== WebSocket.OPEN || session.ws.bufferedAmount > 0) { metrics.snapshotsSkipped++; return; }
  const started = performance.now();
  const state = rooms.stateFor(session.id!);
  if (session.roomEpoch !== state.epoch) {
    if (!send(session, { type: 'room', room: state })) return;
    session.roomEpoch = state.epoch;
  }
  const notice = rooms.takeNotice(session.id!);
  if (notice) send(session, { type: 'notice', message: notice, tone: 'info' });
  const result = rooms.takeMatchResult(session.id!);
  if (result) send(session, { type: 'match-result', result });
  for (const win of rooms.takeBetWins(session.id!)) send(session, { type: 'bet-win', win });
  const snapshot = rooms.snapshotFor(session.id!);
  if (snapshot) {
    const prepared = session.snapshots.prepare(snapshot, state);
    if (send(session, prepared.packet)) prepared.commit();
  }
  metrics.snapshot(performance.now() - started);
}

wss.on('connection', (ws, request) => {
  const ip = request.socket.remoteAddress ?? 'unknown';
  ipConnections.set(ip, (ipConnections.get(ip) ?? 0) + 1);
  const session: Session = { ws, snapshots: new SnapshotEncoder(), ip, alive: true, receivedAt: performance.now(), tokens: 100, socialTokens: 8, interactionTokens: 12, badPackets: 0, helloDeadline: setTimeout(() => fatal(session, 'Accesso scaduto.'), 5000) };
  sessions.set(ws, session);
  ws.on('pong', () => { session.alive = true; });
  ws.on('error', () => { /* close callback owns lifecycle; malformed clients are isolated. */ });
  ws.on('message', async (raw, binary) => {
    if (closing) return;
    const at = performance.now();
    const elapsed = Math.max(0, (at - session.receivedAt) / 1000);
    session.tokens = Math.min(100, session.tokens + elapsed * 75);
    session.socialTokens = Math.min(8, session.socialTokens + elapsed * 2);
    session.interactionTokens = Math.min(12, session.interactionTokens + elapsed * 6);
    session.receivedAt = at;
    if (binary || session.tokens < 1) { fatal(session, 'Troppi messaggi o formato non valido.'); return; }
    session.tokens--;
    let message: ClientMessage;
    try {
      const parsed: unknown = JSON.parse(raw.toString());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('type' in parsed) || typeof parsed.type !== 'string') throw new Error();
      message = parsed as ClientMessage;
    } catch { fatal(session, 'Messaggio non valido.'); return; }

    if (message.type === 'hello') {
      if (!healthy || closing) { fatal(session, 'Server in chiusura.'); return; }
      if (session.id || session.authenticating) { fatal(session, 'Accesso già in corso o completato.'); return; }
      if (message.protocol !== PROTOCOL_VERSION || typeof message.classId !== 'string' || !Object.hasOwn(CLASSES, message.classId)) {
        fatal(session, 'Client non compatibile o dati non validi.');
        return;
      }

      let authResult: { account: Account; token: string };
      let authenticated = false;
      session.authenticating = true;
      try {
        if (message.token) {
          if (typeof message.token !== 'string') throw new Error('Formato token di sessione non valido.');
          authResult = store.authenticateJwt(message.token);
        } else {
          authResult = await authenticateCredentials(ip, message.mode ?? 'login', message.name, message.password);
        }

        authenticated = true;
        if (closing || ws.readyState !== WebSocket.OPEN || !sessions.has(ws)) return;
        const { account, token } = authResult;
        const previous = byAccount.get(account.id);
        const player = rooms.connect(account, message.classId as ClassId);
        session.id = account.id;
        byAccount.set(account.id, session);
        clearTimeout(session.helloDeadline);
        if (previous && previous !== session) {
          send(previous, { type: 'error', message: 'Account aperto in un’altra scheda. Questa sessione è stata chiusa.', fatal: true });
          previous.ws.close(4001, 'Sessione sostituita');
        }
        send(session, { type: 'welcome', token, account: publicAccount(account), playerId: player.id, seed: rooms.simulationFor(account.id).seed, tickRate: TICK_RATE, time: simulation.now, social: rooms.socialFor(account.id) });
        sendSnapshot(session);
        socialBroadcast();
      } catch (error) {
        fatal(session, error instanceof Error ? error.message : 'Accesso non riuscito.', !!message.token && !authenticated);
      } finally {
        session.authenticating = false;
      }
      return;
    }

    if (!session.id || byAccount.get(session.id) !== session) { fatal(session, 'Esegui prima l’accesso.'); return; }
    if (message.type === 'leave') {
      rooms.disconnect(session.id, true);
      byAccount.delete(session.id);
      ws.close(1000, 'Uscita volontaria');
      socialBroadcast();
      return;
    }
    if (message.type === 'input') {
      if (typeof message.roomId !== 'string' || !Number.isSafeInteger(message.epoch) || !message.input || typeof message.input !== 'object' || !rooms.enqueueInput(session.id, message.input, message.roomId, message.epoch)) {
        if (++session.badPackets > 8) fatal(session, 'Comandi di movimento non validi.');
      }
    } else if (message.type === 'interaction') {
      if (session.interactionTokens < 1) { send(session, { type: 'notice', message: 'Attendi un momento prima di interagire ancora.', tone: 'error' }); return; }
      session.interactionTokens--;
      if (typeof message.roomId !== 'string' || !Number.isSafeInteger(message.epoch)) { fatal(session, 'Interazione non valida.'); return; }
      try {
        if (rooms.interact(session.id, message.command, message.roomId, message.epoch)) {
          store.flush(); await store.drain();
          if (!closing && byAccount.get(session.id) === session) sendSnapshot(session);
        }
      } catch (error) { send(session, { type: 'notice', message: error instanceof Error ? error.message : 'Interazione non riuscita.', tone: 'error' }); }
    } else if (message.type === 'betting') {
      if (session.interactionTokens < 1) { send(session, { type: 'notice', message: 'Attendi un momento.', tone: 'error' }); return; }
      session.interactionTokens--;
      try {
        rooms.bettingAction(session.id, message.action);
        store.flush(); await store.drain();
        if (!closing && byAccount.get(session.id) === session) sendSnapshot(session);
      } catch (error) { send(session, { type: 'notice', message: error instanceof Error ? error.message : 'Scommessa non riuscita.', tone: 'error' }); }
    } else if (message.type === 'ping') {
      if (!Number.isFinite(message.at) || Math.abs(message.at) > 1e15) { fatal(session, 'Ping non valido.'); return; }
      send(session, { type: 'pong', at: message.at, time: simulation.now });
    } else if (message.type === 'social') {
      if (session.socialTokens < 1) { send(session, { type: 'notice', message: 'Attendi prima di inviare altre richieste.', tone: 'error' }); return; }
      session.socialTokens--;
      if (!['friend-request', 'friend-accept', 'friend-decline', 'friend-remove', 'team-invite', 'team-accept', 'team-decline', 'team-leave'].includes(message.action) || (message.targetId !== undefined && (typeof message.targetId !== 'string' || message.targetId.length > 80))) { fatal(session, 'Azione sociale non valida.'); return; }
      try {
        const notice = rooms.socialAction(session.id, message.action, message.targetId);
        store.flush();
        await store.drain();
        if (closing || byAccount.get(session.id) !== session) return;
        if (notice) send(session, { type: 'notice', message: notice, tone: 'success' });
        socialBroadcast();
      } catch (error) { send(session, { type: 'notice', message: error instanceof Error ? error.message : 'Azione non riuscita.', tone: 'error' }); }
    } else fatal(session, 'Tipo di messaggio sconosciuto.');
  });
  ws.on('close', () => {
    clearTimeout(session.helloDeadline);
    sessions.delete(ws);
    const count = (ipConnections.get(ip) ?? 1) - 1;
    if (count > 0) ipConnections.set(ip, count); else ipConnections.delete(ip);
    if (session.id && byAccount.get(session.id) === session) {
      byAccount.delete(session.id);
      rooms.disconnect(session.id);
      socialBroadcast();
    }
  });
});

let previousTime = performance.now();
let accumulator = 0;
const stepTimer = setInterval(() => {
  const current = performance.now();
  accumulator += Math.min(250, current - previousTime);
  previousTime = current;
  let steps = 0;
  let snapshotDue = false;
  const started = performance.now();
  try {
    while (accumulator >= 1000 / TICK_RATE && steps < 5) {
      steps++;
      const stepStarted = performance.now();
      rooms.step(DT);
      metrics.step(performance.now() - stepStarted);
      accumulator -= 1000 / TICK_RATE;
      if (simulation.tick % (TICK_RATE / SNAPSHOT_RATE) === 0) snapshotDue = true;
    }
    // Catch-up ticks publish only the freshest state, never a burst of stale snapshots.
    if (snapshotDue) for (const session of byAccount.values()) sendSnapshot(session);
    if (steps >= 5) accumulator = Math.min(accumulator, 1000 / TICK_RATE);
    metrics.catchupTicks += Math.max(0, steps - 1);
    tickCostMs = performance.now() - started;
  } catch (error) { console.error('Simulazione arrestata:', error); healthy = false; void shutdown(1); }
}, 8);

const socialTimer = setInterval(socialBroadcast, 2000);
const persistTimer = setInterval(() => {
  try { rooms.checkpoint(); store.flush(); } catch (error) { console.error('Persistenza non disponibile:', error); healthy = false; void shutdown(1); }
  for (const [ip, entry] of registrations) if (entry.until < Date.now()) registrations.delete(ip);
}, 5000);
const heartbeatTimer = setInterval(() => {
  for (const session of sessions.values()) {
    if (!session.alive) { session.ws.terminate(); continue; }
    session.alive = false;
    session.ws.ping();
  }
}, 15_000);

async function shutdown(exitCode = 0): Promise<void> {
  if (closing) return;
  closing = true;
  authLifetime.abort();
  healthy = false;
  rooms.stopTransfers();
  for (const timer of [stepTimer, socialTimer, persistTimer, heartbeatTimer]) clearInterval(timer);
  for (const session of sessions.values()) { clearTimeout(session.helloDeadline); session.ws.close(1001, 'Server in riavvio'); }
  let saveError: unknown;
  try { rooms.checkpoint(); store.flush(); } catch (error) { saveError = error; }
  try { await store.drain(); } catch (error) { saveError ??= error; }
  if (saveError) { console.error('Salvataggio finale fallito:', saveError); exitCode = 1; }
  try { await vite?.close(); } catch (error) { console.error('Chiusura frontend fallita:', error); exitCode = 1; }
  wss.close();
  server.close(() => process.exit(exitCode));
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
saves.onFailure(error => { console.error('Persistenza non disponibile:', error); healthy = false; void shutdown(1); });
server.listen(port, process.env.HOST ?? '0.0.0.0', () => console.log(`Riftlands: http://localhost:${port} · ${production ? 'production' : 'development'} · authoritative ${TICK_RATE} Hz`));
