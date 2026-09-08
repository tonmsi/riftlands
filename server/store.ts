import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Actor, PublicAccount } from '../shared/types';
import { CLASSES } from '../shared/config';

export interface Account {
  id: string;
  tokenHash: string;
  name: string;
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
  return name.replace(/[\p{C}<>]/gu, '').trim().slice(0, 20) || 'Viandante';
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

function validBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const actor = body as Actor;
  if (actor.kind !== 'player' || typeof actor.id !== 'string' || typeof actor.name !== 'string' || !Object.hasOwn(CLASSES, actor.classId ?? '')) return false;
  if (![actor.x, actor.y, actor.radius, actor.hp, actor.maxHp, actor.resource, actor.maxResource, actor.aim, actor.speed, actor.level, actor.xp, actor.kills, actor.deaths, actor.revealedUntil, actor.deadUntil, actor.spawnProtectedUntil].every(Number.isFinite)) return false;
  if (actor.maxHp <= 0 || actor.hp < 0 || actor.hp > actor.maxHp || actor.resource < 0 || actor.resource > actor.maxResource || actor.radius <= 0 || !Array.isArray(actor.effects) || actor.effects.length > 10 || !actor.cooldowns || typeof actor.cooldowns !== 'object') return false;
  if (!['basic', 'q', 'e', 'r'].every(slot => Number.isFinite(actor.cooldowns[slot as keyof Actor['cooldowns']]))) return false;
  return actor.effects.every(effect => effect && ['haste', 'power', 'weakness', 'slow', 'shield'].includes(effect.kind) && Number.isFinite(effect.until));
}

/** Opaque bearer credentials are hashed at rest. Never log token values. */
export class AccountStore {
  readonly accounts = new Map<string, Account>();
  private tokens = new Map<string, string>();
  private dirty = false;
  readonly path: string;

  constructor(path = resolve('data/accounts.json')) {
    this.path = path;
    if (!existsSync(path)) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1 || !('accounts' in parsed) || !Array.isArray(parsed.accounts)) throw new Error('Formato account non supportato');
      for (const entry of parsed.accounts) {
        if (!entry || typeof entry.id !== 'string' || typeof entry.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.tokenHash) || typeof entry.name !== 'string' || !Array.isArray(entry.friends) || !Array.isArray(entry.requests) || ![entry.xp, entry.kills, entry.deaths, entry.lastSeen].every(Number.isFinite)) throw new Error('Account danneggiato');
        if (entry.friends.length > 100 || entry.requests.length > 50 || ![...entry.friends, ...entry.requests].every(id => typeof id === 'string') || (entry.body !== undefined && (!validBody(entry.body) || entry.body.id !== entry.id))) throw new Error('Stato account danneggiato');
        if (this.accounts.has(entry.id) || this.tokens.has(entry.tokenHash)) throw new Error('Identità account duplicata');
        this.accounts.set(entry.id, entry as Account);
        this.tokens.set(entry.tokenHash, entry.id);
      }
    } catch (error) {
      // Fail closed; an operator must restore a backup. Never overwrite corrupt data.
      throw new Error(`Impossibile caricare ${path}. Ripristina un backup prima di riavviare. ${String(error)}`);
    }
  }

  authenticate(token: string | undefined, name: string): { account: Account; token: string } {
    if (token !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Codice account non valido. Usa il codice salvato o crea una nuova identità.');
      const tokenHash = hash(token);
      const id = this.tokens.get(tokenHash);
      const account = id ? this.accounts.get(id) : undefined;
      if (!account || !timingSafeEqual(Buffer.from(account.tokenHash, 'hex'), Buffer.from(tokenHash, 'hex'))) throw new Error('Codice account sconosciuto. Usa il codice salvato o crea una nuova identità.');
      account.name = cleanName(name);
      account.lastSeen = Date.now();
      this.touch();
      return { account, token };
    }
    if (this.accounts.size >= 100_000) throw new Error('Limite account raggiunto.');
    const nextToken = randomBytes(32).toString('hex');
    const account: Account = { id: randomUUID(), tokenHash: hash(nextToken), name: cleanName(name), kills: 0, deaths: 0, xp: 0, friends: [], requests: [], lastSeen: Date.now() };
    this.accounts.set(account.id, account);
    this.tokens.set(account.tokenHash, account.id);
    this.touch();
    // Persist before acknowledging account creation, so a crash cannot lose identity.
    this.flush();
    return { account, token: nextToken };
  }

  touch(): void { this.dirty = true; }

  flush(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const next = `${this.path}.tmp`;
    writeFileSync(next, JSON.stringify({ version: 1, accounts: [...this.accounts.values()] }), { mode: 0o600 });
    renameSync(next, this.path);
    this.dirty = false;
  }
}
