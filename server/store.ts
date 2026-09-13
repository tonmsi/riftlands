import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Actor, PublicAccount } from '../shared/types';
import { CLASSES } from '../shared/config';

export interface Account {
  id: string;
  name: string;
  nameLower: string;
  salt: string;
  passwordHash: string;
  kills: number;
  deaths: number;
  xp: number;
  friends: string[];
  requests: string[];
  lastSeen: number;
  body?: Actor;
}

export function publicAccount(account: Account): PublicAccount {
  const { id, name, kills, deaths, xp } = account;
  return { id, name, kills, deaths, xp };
}

export function cleanName(name: string): string {
  return name.replace(/[\p{C}<>]/gu, '').trim().slice(0, 20);
}

function validBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const actor = body as Actor;
  if (actor.pvpUntil !== undefined && (!Number.isFinite(actor.pvpUntil) || actor.pvpUntil < 0)) return false;
  if (actor.kind !== 'player' || typeof actor.id !== 'string' || typeof actor.name !== 'string' || !Object.hasOwn(CLASSES, actor.classId ?? '')) return false;
  if (![actor.x, actor.y, actor.radius, actor.hp, actor.maxHp, actor.resource, actor.maxResource, actor.aim, actor.speed, actor.level, actor.xp, actor.kills, actor.deaths, actor.revealedUntil, actor.deadUntil, actor.spawnProtectedUntil].every(Number.isFinite)) return false;
  if (actor.maxHp <= 0 || actor.hp < 0 || actor.hp > actor.maxHp || actor.resource < 0 || actor.resource > actor.maxResource || actor.radius <= 0 || !Array.isArray(actor.effects) || actor.effects.length > 10 || !actor.cooldowns || typeof actor.cooldowns !== 'object') return false;
  if (!['basic', 'q', 'e', 'r'].every(slot => Number.isFinite(actor.cooldowns[slot as keyof Actor['cooldowns']]))) return false;
  return actor.effects.every(effect => effect && ['haste', 'power', 'weakness', 'slow', 'shield','root'].includes(effect.kind) && Number.isFinite(effect.until));
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str).toString('base64url');
}

function base64UrlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf8');
}

function getJwtSecret(baseDir: string): string {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
    return process.env.JWT_SECRET;
  }
  const secretPath = resolve(baseDir, 'jwt.secret');
  if (existsSync(secretPath)) {
    const existing = readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  }
  mkdirSync(baseDir, { recursive: true });
  const generated = randomBytes(32).toString('hex');
  writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

export class AccountStore {
  readonly accounts = new Map<string, Account>();
  private readonly accountsByName = new Map<string, string>(); // nameLower -> account.id
  private dirty = false;
  readonly path: string;
  private readonly jwtSecret: string;

  constructor(path = resolve('data/accounts.json')) {
    this.path = path;
    this.jwtSecret = getJwtSecret(dirname(path));

    if (!existsSync(path)) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 2 || !('accounts' in parsed) || !Array.isArray(parsed.accounts)) {
        // Se è versione 1 o formato precedente, consideriamo gli account azzerati come da specifica
        if (parsed && typeof parsed === 'object' && 'version' in parsed && parsed.version === 1) {
          this.dirty = true;
          this.flush();
          return;
        }
        throw new Error('Formato account non supportato.');
      }

      for (const entry of parsed.accounts) {
        if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.nameLower !== 'string' || typeof entry.salt !== 'string' || typeof entry.passwordHash !== 'string' || !Array.isArray(entry.friends) || !Array.isArray(entry.requests) || ![entry.xp, entry.kills, entry.deaths, entry.lastSeen].every(Number.isFinite)) {
          throw new Error('Account danneggiato.');
        }
        if (entry.friends.length > 100 || entry.requests.length > 50 || ![...entry.friends, ...entry.requests].every(id => typeof id === 'string') || (entry.body !== undefined && (!validBody(entry.body) || entry.body.id !== entry.id))) {
          throw new Error('Stato account non valido.');
        }
        if (this.accounts.has(entry.id) || this.accountsByName.has(entry.nameLower)) {
          throw new Error('Nome o ID account duplicato.');
        }

        const account = entry as Account;
        this.accounts.set(account.id, account);
        this.accountsByName.set(account.nameLower, account.id);
      }
    } catch (error) {
      throw new Error(`Impossibile caricare ${path}. Ripristina o azzera il file prima di riavviare. ${String(error)}`);
    }
  }

  private hashPassword(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString('hex');
  }

  signJwt(account: Account): string {
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const payload = base64UrlEncode(JSON.stringify({
      sub: account.id,
      name: account.name,
      iat: now,
      exp: now + 30 * 24 * 3600 // 30 giorni
    }));
    const signature = createHmac('sha256', this.jwtSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    return `${header}.${payload}.${signature}`;
  }

  verifyJwt(token: string): { sub: string; name: string } | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const expected = createHmac('sha256', this.jwtSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null;
    }

    try {
      const data = JSON.parse(base64UrlDecode(payload));
      if (!data || typeof data !== 'object' || typeof data.sub !== 'string' || typeof data.exp !== 'number') return null;
      if (data.exp < Math.floor(Date.now() / 1000)) return null;
      return { sub: data.sub, name: data.name ?? '' };
    } catch {
      return null;
    }
  }

  register(name: string, password: string): { account: Account; token: string } {
    const cleaned = cleanName(name);
    if (cleaned.length < 2) throw new Error('Il nome del personaggio deve avere almeno 2 caratteri.');
    if (cleaned.length > 20) throw new Error('Il nome del personaggio può contenere al massimo 20 caratteri.');
    if (typeof password !== 'string' || password.length < 4) throw new Error('La password deve contenere almeno 4 caratteri.');
    if (password.length > 100) throw new Error('La password è troppo lunga (max 100 caratteri).');
    if (this.accounts.size >= 100_000) throw new Error('Limite account server raggiunto.');

    const nameLower = cleaned.toLowerCase();
    if (this.accountsByName.has(nameLower)) {
      throw new Error('Questo nome è già stato scelto da un altro giocatore.');
    }

    const salt = randomBytes(16).toString('hex');
    const passwordHash = this.hashPassword(password, salt);
    const account: Account = {
      id: randomUUID(),
      name: cleaned,
      nameLower,
      salt,
      passwordHash,
      kills: 0,
      deaths: 0,
      xp: 0,
      friends: [],
      requests: [],
      lastSeen: Date.now()
    };

    this.accounts.set(account.id, account);
    this.accountsByName.set(nameLower, account.id);
    this.touch();
    this.flush();

    const token = this.signJwt(account);
    return { account, token };
  }

  login(name: string, password: string): { account: Account; token: string } {
    const cleaned = cleanName(name);
    const nameLower = cleaned.toLowerCase();
    const id = this.accountsByName.get(nameLower);
    if (!id) throw new Error('Nome personaggio o password non validi.');
    const account = this.accounts.get(id);
    if (!account) throw new Error('Nome personaggio o password non validi.');

    const computed = this.hashPassword(password, account.salt);
    const match = computed.length === account.passwordHash.length &&
      timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(account.passwordHash, 'hex'));
    if (!match) throw new Error('Nome personaggio o password non validi.');

    account.lastSeen = Date.now();
    this.touch();
    const token = this.signJwt(account);
    return { account, token };
  }

  authenticateJwt(token: string): { account: Account; token: string } {
    const payload = this.verifyJwt(token);
    if (!payload) throw new Error('Sessione scaduta o non valida. Accedi di nuovo.');
    const account = this.accounts.get(payload.sub);
    if (!account) throw new Error('Account non trovato. Crea un nuovo personaggio.');
    account.lastSeen = Date.now();
    this.touch();
    return { account, token };
  }

  touch(): void { this.dirty = true; }

  flush(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const next = `${this.path}.tmp`;
    writeFileSync(next, JSON.stringify({ version: 2, accounts: [...this.accounts.values()] }), { mode: 0o600 });
    renameSync(next, this.path);
    this.dirty = false;
  }
}
