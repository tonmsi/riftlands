import { PROTOCOL_VERSION } from '../shared/config';
import type { ClassId, ClientMessage, ServerMessage, RoomState, InputCommand } from '../shared/types';

export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline';
export interface NetworkCallbacks {
  message: (message: ServerMessage) => void;
  status: (status: ConnectionStatus, detail?: string) => void;
  reset: () => void;
  authExpired?: () => void;
}

const JWT_KEY = 'riftlands.jwt';

type JoinRequest =
  | { type: 'token'; classId: ClassId }
  | { type: 'credentials'; mode: 'login' | 'register'; name: string; password: string; classId: ClassId };

export class GameConnection {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private attempts = 0;
  private intentional = true;
  private welcomed = false;
  private room: RoomState | null = null;
  private generation = 0;
  private joinRequest: JoinRequest | null = null;
  private clockOffset = Date.now() - performance.now();
  private clockSynced = false;
  private lastReceived = 0;
  private token: string | undefined;
  ping = 0;

  constructor(private callbacks: NetworkCallbacks) {
    try {
      this.token = localStorage.getItem(JWT_KEY) || undefined;
    } catch { /* Storage non disponibile */ }
  }

  get connected(): boolean {
    return this.welcomed && this.socket?.readyState === WebSocket.OPEN;
  }

  serverTime(): number {
    return performance.now() + this.clockOffset;
  }

  hasToken(): boolean {
    return Boolean(this.token);
  }

  getToken(): string | undefined {
    return this.token;
  }

  logout(): void {
    this.leave();
    this.token = undefined;
    try {
      localStorage.removeItem(JWT_KEY);
    } catch { /* Storage non disponibile */ }
  }

  joinWithCredentials(mode: 'login' | 'register', name: string, password: string, classId: ClassId): void {
    this.leave();
    this.joinRequest = { type: 'credentials', mode, name, password, classId };
    this.intentional = false;
    this.attempts = 0;
    this.connect();
  }

  joinWithToken(classId: ClassId): void {
    if (!this.token) throw new Error('Nessuna sessione attiva disponibile.');
    this.leave();
    this.joinRequest = { type: 'token', classId };
    this.intentional = false;
    this.attempts = 0;
    this.connect();
  }

  private connect(): void {
    if (this.intentional || !this.joinRequest) return;
    const generation = ++this.generation;
    this.welcomed = false;
    this.callbacks.reset();
    this.callbacks.status(this.attempts ? 'reconnecting' : 'connecting');

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${protocol}//${location.host}/ws`);
    } catch {
      this.retry(generation, 'Impossibile aprire la connessione.');
      return;
    }

    this.socket = socket;
    this.lastReceived = performance.now();

    this.deadlineTimer = setTimeout(() => this.retry(generation, 'Accesso al mondo scaduto.'), 10_000);
    this.watchdogTimer = setInterval(() => {
      if (generation !== this.generation || !this.welcomed) return;
      if (performance.now() - this.lastReceived > 10_000) this.retry(generation, 'Il server non risponde.');
    }, 1000);

    socket.onopen = () => {
      if (generation !== this.generation || !this.joinRequest) return;
      let helloMessage: ClientMessage;

      if (this.joinRequest.type === 'token') {
        helloMessage = {
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          classId: this.joinRequest.classId,
          token: this.token
        };
      } else {
        helloMessage = {
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          classId: this.joinRequest.classId,
          mode: this.joinRequest.mode,
          name: this.joinRequest.name,
          password: this.joinRequest.password
        };
      }

      if (!this.send(helloMessage)) this.retry(generation, 'Accesso al mondo non inviato.');
    };

    socket.onmessage = event => {
      if (generation !== this.generation) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
      this.lastReceived = performance.now();

      if (message.type === 'welcome') {
        if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
        this.deadlineTimer = null;
        this.token = message.token;
        // A reconnect after registration must resume the account, not register it again.
        if (this.joinRequest) this.joinRequest = { type: 'token', classId: this.joinRequest.classId };
        try {
          localStorage.setItem(JWT_KEY, message.token);
        } catch { /* Storage privato o limitato */ }

        this.clockOffset = message.time - performance.now();
        this.clockSynced = false;
        this.ping = 0;
        this.attempts = 0;
        this.welcomed = true;
        this.send({ type: 'ping', at: performance.now() });

        if (!this.pingTimer) {
          this.pingTimer = setInterval(() => {
            if (generation === this.generation) this.send({ type: 'ping', at: performance.now() });
          }, 1500);
        }
        this.callbacks.status('online');
      } else if (message.type === 'room') {
        this.room = message.room;
        this.callbacks.reset();
      } else if (message.type === 'pong') {
        const rtt = Math.max(0, performance.now() - message.at);
        this.ping = Math.round(this.ping ? this.ping * 0.6 + rtt * 0.4 : rtt);
        const offset = message.time + rtt / 2 - performance.now();
        this.clockOffset = this.clockSynced ? this.clockOffset * 0.8 + offset * 0.2 : offset;
        this.clockSynced = true;
      } else if (message.type === 'error' && message.fatal) {
        if (message.authExpired && this.joinRequest?.type === 'token') {
          // Token non più valido sul server
          this.logout();
          this.callbacks.authExpired?.();
        }
        this.stop(generation, message.message);
      }

      this.callbacks.message(message);
    };

    socket.onerror = () => { /* gestito da onclose e watchdog */ };

    socket.onclose = event => {
      if (generation !== this.generation || this.intentional) return;
      if (event.code === 4001 || event.code === 4003 || event.code === 4009 || event.code === 1008) {
        this.stop(generation, event.reason || 'Sessione chiusa. Rientra dal menu.');
        return;
      }
      this.retry(generation);
    };
  }

  private retireSocket(): void {
    this.generation++;
    this.welcomed = false;
    this.room = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.pingTimer = null;
    this.deadlineTimer = null;
    this.watchdogTimer = null;

    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      try { socket.close(1000, 'Connessione conclusa'); } catch { /* ignore */ }
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

  send(message: ClientMessage | { type: 'input'; input: InputCommand }): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 64_000) return false;
    if (message.type === 'input') {
      if (!this.welcomed || !this.room) return false;
      message = { ...message, roomId: this.room.id, epoch: this.room.epoch };
    }
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  leave(): void {
    if (this.welcomed) this.send({ type: 'leave' });
    this.room = null;
    this.intentional = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.retireSocket();
    this.callbacks.status('idle');
  }
}
