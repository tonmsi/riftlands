import { PROTOCOL_VERSION } from '../shared/config';
import type { ClassId, ClientMessage, ServerMessage } from '../shared/types';

export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline';
export interface NetworkCallbacks { message: (message: ServerMessage) => void; status: (status: ConnectionStatus, detail?: string) => void; reset: () => void; }
const TOKEN_KEY = 'riftlands.account';

export class GameConnection {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private attempts = 0;
  private intentional = true;
  private welcomed = false;
  private generation = 0;
  private joined: { name: string; classId: ClassId } | null = null;
  private clockOffset = Date.now() - performance.now();
  private lastReceived = 0;
  private token: string | undefined;
  ping = 0;
  constructor(private callbacks: NetworkCallbacks) {
    try { this.token = localStorage.getItem(TOKEN_KEY) || undefined; } catch { /* Session still works with in-memory credentials. */ }
  }
  get connected(): boolean { return this.welcomed && this.socket?.readyState === WebSocket.OPEN; }
  serverTime(): number { return performance.now() + this.clockOffset; }
  getAccountToken(): string | undefined { return this.token; }

  useAccountToken(token: string): void {
    const normalized = token.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('Il codice account deve contenere 64 caratteri esadecimali.');
    this.leave();
    this.token = normalized;
    try { localStorage.setItem(TOKEN_KEY, normalized); } catch { /* Keep imported credentials for this session. */ }
  }

  resetIdentity(): void {
    this.leave();
    this.token = undefined;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* In-memory identity is still reset. */ }
  }

  join(name: string, classId: ClassId): void {
    this.leave();
    this.joined = { name, classId }; this.intentional = false; this.attempts = 0;
    this.connect();
  }

  private connect(): void {
    if (this.intentional || !this.joined) return;
    const generation = ++this.generation;
    this.welcomed = false;
    this.callbacks.reset();
    this.callbacks.status(this.attempts ? 'reconnecting' : 'connecting');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket;
    try { socket = new WebSocket(`${protocol}//${location.host}/ws`); }
    catch { this.retry(generation, 'Impossibile aprire la connessione.'); return; }
    this.socket = socket;
    this.lastReceived = performance.now();
    // Covers both a stalled WebSocket opening handshake and an unanswered hello.
    this.deadlineTimer = setTimeout(() => this.retry(generation, 'Accesso al mondo scaduto.'), 10_000);
    this.watchdogTimer = setInterval(() => {
      if (generation !== this.generation || !this.welcomed) return;
      if (performance.now() - this.lastReceived > 10_000) this.retry(generation, 'Il server non risponde.');
    }, 1000);
    socket.onopen = () => {
      if (generation !== this.generation || !this.joined) return;
      if (!this.send({ type: 'hello', token: this.token, ...this.joined, protocol: PROTOCOL_VERSION })) this.retry(generation, 'Accesso al mondo non inviato.');
    };
    socket.onmessage = event => {
      if (generation !== this.generation) return;
      let message: ServerMessage;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
      this.lastReceived = performance.now();
      if (message.type === 'welcome') {
        if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
        this.deadlineTimer = null;
        this.token = message.token;
        try { localStorage.setItem(TOKEN_KEY, message.token); } catch { /* Private/limited storage. */ }
        this.clockOffset = message.time - performance.now();
        this.attempts = 0; this.welcomed = true;
        if (!this.pingTimer) this.pingTimer = setInterval(() => {
          if (generation === this.generation) this.send({ type: 'ping', at: performance.now() });
        }, 1500);
        this.callbacks.status('online');
      } else if (message.type === 'pong') {
        const rtt = Math.max(0, performance.now() - message.at);
        this.ping = Math.round(this.ping ? this.ping * 0.6 + rtt * 0.4 : rtt);
        const offset = message.time + rtt / 2 - performance.now();
        this.clockOffset = this.clockOffset * 0.8 + offset * 0.2;
      } else if (message.type === 'error' && message.fatal) {
        this.stop(generation, message.message);
      }
      this.callbacks.message(message);
    };
    socket.onerror = () => { /* close or the independent watchdog drives one retry path. */ };
    socket.onclose = event => {
      if (generation !== this.generation) return;
      if (this.intentional) return;
      // Explicit policy failures/session takeover must never fight another active tab.
      if (event.code === 4001 || event.code === 4003 || event.code === 4009 || event.code === 1008) {
        this.stop(generation, event.reason || 'Sessione chiusa. Rientra dal menu.');
        return;
      }
      this.retry(generation);
    };
  }

  /** Retire first: late close/message events from this socket can never change its successor. */
  private retireSocket(): void {
    this.generation++;
    this.welcomed = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.pingTimer = null; this.deadlineTimer = null; this.watchdogTimer = null;
    const socket = this.socket;
    this.socket = null;
    // Browser close handshakes can stall on a dead network; never await their completion.
    if (socket && socket.readyState < WebSocket.CLOSING) {
      try { socket.close(1000, 'Connessione conclusa'); } catch { /* Already failed or closing. */ }
    }
  }

  private retry(generation: number, detail?: string): void {
    if (generation !== this.generation || this.intentional) return;
    this.retireSocket();
    this.callbacks.reset();
    this.attempts++;
    this.callbacks.status('reconnecting', `${detail ? `${detail} ` : ''}Tentativo ${this.attempts}`);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(10_000, 600 * 2 ** Math.min(4, this.attempts - 1)) + Math.random() * 250;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private stop(generation: number, detail: string): void {
    if (generation !== this.generation) return;
    this.intentional = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.retireSocket();
    this.callbacks.reset();
    this.callbacks.status('offline', detail);
  }

  send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 64_000) return false;
    if (message.type === 'input' && !this.welcomed) return false;
    try { this.socket.send(JSON.stringify(message)); return true; }
    catch { return false; }
  }

  leave(): void {
    this.intentional = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.retireSocket();
    this.callbacks.status('idle');
  }
}
