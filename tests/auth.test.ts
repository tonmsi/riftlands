import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../server/store';
import { AuthBudget } from '../server/auth-budget';

test('malformed Unicode JWT signatures never throw, and concurrent registrations preserve uniqueness', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-auth-'));
  try {
    const store = new AccountStore(join(directory, 'accounts.json'));
    assert.equal(store.verifyJwt(`header.payload.${'é'.repeat(43)}`), null);
    const results = await Promise.allSettled([store.registerAsync('Alice', 'password'), store.registerAsync('alice', 'password')]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(store.accounts.size, 1);
    const login = await store.loginAsync('ALICE', 'password');
    assert.equal(store.verifyJwt(login.token)?.sub, login.account.id);
    await assert.rejects(store.loginAsync('Alice', 'wrong'));
    await assert.rejects(store.loginAsync('unknown', 'password'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('password budget limits concurrent work and attempts across new sockets', () => {
  const budget = new AuthBudget();
  const releases = Array.from({ length: 4 }, () => budget.acquire('same-ip', 0)!);
  assert.equal(budget.acquire('other-ip', 0), null);
  releases.forEach(release => { release(); release(); });
  for (let i = 0; i < 4; i++) budget.acquire('same-ip', 0)!();
  assert.equal(budget.acquire('same-ip', 0), null);
  assert.ok(budget.acquire('same-ip', 7500));
});
