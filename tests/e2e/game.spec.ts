import { test, expect, type Page } from '@playwright/test';
import type { ServerMessage, Snapshot } from '../../shared/types';

function observe(page: Page): { snapshot?: Snapshot; messages: ServerMessage[]; errors: string[] } {
  const state: { snapshot?: Snapshot; messages: ServerMessage[]; errors: string[] } = { messages: [], errors: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('websocket', socket => {
    if (!socket.url().includes('/ws')) return;
    socket.on('framereceived', event => {
      const message = JSON.parse(String(event.payload)) as ServerMessage;
      if (message.type === 'snapshot') state.snapshot = message;
      state.messages.push(message);
      if (state.messages.length > 500) state.messages.shift();
    });
  });
  return state;
}
async function join(page: Page, name: string, classId = 'mage'): Promise<void> {
  await page.goto('/'); await page.getByLabel('Nome del personaggio').fill(name);
  await page.locator(`[data-class="${classId}"]`).click();
  await page.getByRole('button', { name: 'Entra nel mondo' }).click();
  await expect(page.locator('.game-hud')).toBeVisible();
  await expect(page.locator('[data-ref="player-name"]')).toHaveText(name);
}

test('two independent players: move, cast, friend consent, team consent, reconnect identity', async ({ browser }) => {
  const contextA = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await contextA.newPage(), b = await contextB.newPage();
  const seenA = observe(a), seenB = observe(b);
  try {
    await join(a, 'Arianna', 'mage'); await join(b, 'Bruno', 'paladin');
    await expect.poll(() => seenA.snapshot?.online).toBeGreaterThanOrEqual(2);
    const idA = seenA.snapshot!.self.id, idB = seenB.snapshot!.self.id;
    expect(idA).not.toBe(idB);
    const oldX = seenA.snapshot!.self.x;
    await a.locator('.world-canvas').focus(); await a.keyboard.down('KeyD');
    await expect.poll(() => (seenA.snapshot?.self.x ?? oldX) - oldX).toBeGreaterThan(40);
    await a.keyboard.up('KeyD');
    await a.keyboard.press('KeyQ');
    await expect.poll(() => seenA.messages.some(message => message.type === 'snapshot' && message.events.some(event => event.actorId === idA && event.kind === 'cast'))).toBe(true);
    await expect.poll(() => seenA.snapshot?.self.resource ?? 120).toBeLessThan(120);
    await a.locator('[data-ref="social-toggle"]').click(); await b.locator('[data-ref="social-toggle"]').click();
    const nearB = a.locator('.social-section').filter({ has: a.getByRole('heading', { name: /Nelle vicinanze/ }) }).locator('.social-row').filter({ hasText: 'Bruno' });
    await nearB.getByRole('button', { name: '+ Amico', exact: true }).click();
    const request = b.locator('.social-row').filter({ hasText: 'Richiesta di amicizia' });
    await expect(request).toBeVisible();
    await expect(a.locator('.social-section').filter({ has: a.getByRole('heading', { name: /^Amici/ }) }).getByText('Bruno', { exact: true })).toHaveCount(0);
    await request.getByRole('button', { name: 'Accetta' }).click();
    await expect(a.locator('.social-section').filter({ has: a.getByRole('heading', { name: /^Amici/ }) }).getByText('Bruno', { exact: true })).toBeVisible();
    await nearB.getByRole('button', { name: '+ Team', exact: true }).click();
    await expect(b.locator('.social-row').filter({ hasText: 'Invito al team' })).toBeVisible();
    expect(seenB.snapshot!.self.teamId).toBeNull();
    await b.getByRole('button', { name: 'Unisciti', exact: true }).click();
    await expect.poll(() => seenB.snapshot?.self.teamId).toBeTruthy();
    await expect.poll(() => seenA.snapshot?.self.teamId).toBe(seenB.snapshot!.self.teamId);
    await a.locator('[data-ref="social-close"]').click();
    await a.screenshot({ path: 'test-results/game-desktop.png' });
    await a.locator('[data-ref="leave"]').click();
    await expect(a.locator('.lobby')).toBeVisible();
    await a.reload(); await a.getByRole('button', { name: 'Entra nel mondo' }).click();
    await expect(a.locator('.game-hud')).toBeVisible();
    await expect.poll(() => seenA.snapshot?.self.id).toBe(idA);
    await expect.poll(() => seenA.messages.filter(m => m.type === 'welcome').length).toBeGreaterThanOrEqual(2);
    await a.locator('[data-ref="social-toggle"]').click();
    await expect(a.locator('.social-section').filter({ has: a.getByRole('heading', { name: /^Amici/ }) }).getByText('Bruno', { exact: true })).toBeVisible();
    expect(seenA.errors).toEqual([]); expect(seenB.errors).toEqual([]);
  } finally { await contextA.close(); await contextB.close(); }
});

test('lobby class selection and narrow viewport fit with no browser errors', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage(); const seen = observe(page);
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Oltre il confine.' })).toBeVisible();
    await page.locator('[data-class="warrior"]').click();
    await expect(page.locator('[data-ref="class-detail"]')).toContainText('RAGE');
    await page.screenshot({ path: 'test-results/lobby-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Entra nel mondo' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'test-results/lobby-mobile.png', fullPage: true });
    expect(seen.errors).toEqual([]);
  } finally { await context.close(); }
});

test('lost connection resumes same identity without replaying stale casts; duplicate tab yields', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const OriginalSocket = window.WebSocket;
    const tracker = window as unknown as { gameSockets: WebSocket[] };
    tracker.gameSockets = [];
    class TrackedSocket extends OriginalSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).endsWith('/ws')) tracker.gameSockets.push(this);
      }
    }
    window.WebSocket = TrackedSocket;
  });
  const a = await context.newPage(), seen = observe(a);
  try {
    await join(a, 'Cora', 'warrior');
    const id = seen.snapshot!.self.id;
    const reconnected = a.waitForEvent('websocket', { predicate: ws => ws.url().endsWith('/ws') });
    await a.evaluate(() => {
      const tracker = window as unknown as { gameSockets: WebSocket[] };
      tracker.gameSockets.at(-1)!.close(4000, 'Interruzione simulata dal test');
    });
    await expect(a.locator('[data-ref="connection-banner"]')).toBeVisible();
    // The free dash would fire on reconnect if disconnected keyboard/UI state leaked.
    await a.keyboard.press('KeyE');
    await reconnected;
    await expect.poll(() => seen.messages.filter(m => m.type === 'welcome').length).toBe(2);
    await expect(a.locator('[data-ref="connection-banner"]')).toBeHidden();
    expect(seen.snapshot!.self.id).toBe(id);
    await expect.poll(() => seen.snapshot!.self.cooldowns.e).toBe(0);
    const b = await context.newPage(); const seenB = observe(b);
    await join(b, 'Cora', 'warrior');
    await expect(a.locator('.lobby')).toBeVisible();
    await expect(a.locator('[data-ref="lobby-connection"]')).toContainText('altra scheda');
    expect(seenB.snapshot!.self.id).toBe(id);
    expect(seen.errors).toEqual([]); expect(seenB.errors).toEqual([]);
  } finally { await context.close(); }
});

test('invalid account can explicitly create a fresh identity and import the saved code', async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage(); const seen = observe(page);
  try {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('riftlands.account', 'bad-code'));
    await page.reload();
    await page.getByLabel('Nome del personaggio').fill('Dario');
    await page.getByRole('button', { name: 'Entra nel mondo' }).click();
    await expect(page.locator('[data-ref="lobby-connection"]')).toContainText('non valido');
    await page.locator('[data-ref="account-toggle"]').click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-ref="account-new"]').click();
    await page.getByRole('button', { name: 'Entra nel mondo' }).click();
    await expect(page.locator('.game-hud')).toBeVisible();
    const id = seen.snapshot!.self.id;
    const savedToken = await page.evaluate(() => localStorage.getItem('riftlands.account')!);
    await page.locator('[data-ref="leave"]').click();
    // Reset locally, then recover via the menu's code import, with no identity auto-creation.
    if (!(await page.locator('[data-ref="account-new"]').isVisible())) await page.locator('[data-ref="account-toggle"]').click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-ref="account-new"]').click();
    await page.locator('[data-ref="account-toggle"]').click();
    await page.locator('[data-ref="account-code"]').fill(savedToken);
    await page.locator('[data-ref="account-use"]').click();
    await page.getByRole('button', { name: 'Entra nel mondo' }).click();
    await expect(page.locator('.game-hud')).toBeVisible();
    await expect.poll(() => seen.messages.filter(m => m.type === 'welcome').length).toBe(2);
    expect(seen.snapshot!.self.id).toBe(id);
    expect(seen.errors).toEqual([]);
  } finally { await context.close(); }
});

test('development server keeps account storage and server source private', async ({ request }) => {
  for (const path of ['/data/accounts.json', '/server/store.ts', '/server/simulation.ts']) {
    const response = await request.get(path);
    expect(response.status()).toBe(403);
  }
});
