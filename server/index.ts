import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer } from 'ws';
import { CLASSES, DT, PROTOCOL_VERSION, SNAPSHOT_RATE, TICK_RATE, WORLD_SEED } from '../shared/config';
import type { ClassId, ClientMessage, ServerMessage } from '../shared/types';
import { Account, AccountStore, publicAccount } from './store';
import { RoomManager } from './rooms';
import { AuthBudget } from './auth-budget';
import { NetworkMetrics } from './metrics';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve essere tra 1 e 65535.');
const store = new AccountStore(process.env.DATA_FILE ? resolve(process.env.DATA_FILE) : resolve(ROOT, 'data/accounts.json'));
const rooms = new RoomManager(store, WORLD_SEED);
const simulation = rooms.global;
let healthy = true;
let closing = false;
let tickCostMs = 0;
const metrics = new NetworkMetrics();
const dist = resolve(ROOT, 'dist');
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const server = createServer((request, response) => {
  const path = (request.url ?? '/').split('?')[0];
  response.setHeader('X-Content-Type-Options', 'nosniff');
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
    response.end(JSON.stringify({ account: account ? publicAccount(account) : null, friends, leaderboard }));
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
type Session = { ws: WebSocket; id?: string; authenticating?: boolean; roomEpoch?: number; ip: string; alive: boolean; receivedAt: number; tokens: number; socialTokens: number; badPackets: number; helloDeadline: ReturnType<typeof setTimeout> };
const sessions = new Map<WebSocket, Session>();
const byAccount = new Map<string, Session>();
const ipConnections = new Map<string, number>();
const registrations = new Map<string, { count: number; until: number }>();
const authBudget = new AuthBudget();

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

function send(session: Session, message: ServerMessage): void {
  if (session.ws.readyState !== WebSocket.OPEN) return;
  if (session.ws.bufferedAmount > 1024 * 1024) { session.ws.close(1008, 'Connessione troppo lenta'); return; }
  if (message.type === 'snapshot' && session.ws.bufferedAmount > 0) return;
  const encoded = JSON.stringify(message);
  session.ws.send(encoded);
  if (message.type === 'snapshot') { metrics.snapshotsSent++; metrics.snapshotBytes += Buffer.byteLength(encoded); }
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
    send(session, { type: 'room', room: state });
    session.roomEpoch = state.epoch;
  }
  const notice = rooms.takeNotice(session.id!);
  if (notice) send(session, { type: 'notice', message: notice, tone: 'info' });
  const snapshot = rooms.snapshotFor(session.id!);
  if (snapshot) send(session, snapshot);
  metrics.snapshot(performance.now() - started);
}

wss.on('connection', (ws, request) => {
  const ip = request.socket.remoteAddress ?? 'unknown';
  ipConnections.set(ip, (ipConnections.get(ip) ?? 0) + 1);
  const session: Session = { ws, ip, alive: true, receivedAt: performance.now(), tokens: 100, socialTokens: 8, badPackets: 0, helloDeadline: setTimeout(() => fatal(session, 'Accesso scaduto.'), 5000) };
  sessions.set(ws, session);
  ws.on('pong', () => { session.alive = true; });
  ws.on('error', () => { /* close callback owns lifecycle; malformed clients are isolated. */ });
  ws.on('message', async (raw, binary) => {
    const at = performance.now();
    const elapsed = Math.max(0, (at - session.receivedAt) / 1000);
    session.tokens = Math.min(100, session.tokens + elapsed * 75);
    session.socialTokens = Math.min(8, session.socialTokens + elapsed * 2);
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
      if (session.id || session.authenticating) { fatal(session, 'Accesso già in corso o completato.'); return; }
      if (message.protocol !== PROTOCOL_VERSION || typeof message.classId !== 'string' || !Object.hasOwn(CLASSES, message.classId)) {
        fatal(session, 'Client non compatibile o dati non validi.');
        return;
      }

      let authResult: { account: Account; token: string };
      let authenticated = false;
      let releaseAuth: (() => void) | null = null;
      session.authenticating = true;
      try {
        if (message.token) {
          if (typeof message.token !== 'string') throw new Error('Formato token di sessione non valido.');
          authResult = store.authenticateJwt(message.token);
        } else {
          const mode = message.mode ?? 'login';
          const name = typeof message.name === 'string' ? message.name : '';
          const password = typeof message.password === 'string' ? message.password : '';
          if (!name || !password) throw new Error('Inserisci sia il nome sia la password.');
          releaseAuth = authBudget.acquire(ip, performance.now());
          if (!releaseAuth) throw new Error('Troppi tentativi di accesso. Riprova tra poco.');

          if (mode === 'register') {
            let entry = registrations.get(ip);
            if (!entry || entry.until < Date.now()) { entry = { count: 0, until: Date.now() + 600_000 }; registrations.set(ip, entry); }
            if (entry.count >= 20) throw new Error('Troppi nuovi personaggi creati di recente. Riprova tra poco.');
            entry.count++;
            authResult = await store.registerAsync(name, password);
          } else if (mode === 'login') {
            authResult = await store.loginAsync(name, password);
          } else {
            throw new Error('Modalità di accesso non supportata.');
          }
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
        releaseAuth?.();
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
  healthy = false;
  for (const timer of [stepTimer, socialTimer, persistTimer, heartbeatTimer]) clearInterval(timer);
  for (const session of sessions.values()) { clearTimeout(session.helloDeadline); session.ws.close(1001, 'Server in riavvio'); }
  try { rooms.checkpoint(); store.flush(); } catch (error) { console.error('Salvataggio finale fallito:', error); exitCode = 1; }
  await vite?.close();
  wss.close();
  server.close(() => process.exit(exitCode));
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
server.listen(port, process.env.HOST ?? '0.0.0.0', () => console.log(`Riftlands: http://localhost:${port} · ${production ? 'production' : 'development'} · authoritative ${TICK_RATE} Hz`));
