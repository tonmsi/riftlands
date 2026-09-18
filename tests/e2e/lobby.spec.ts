import { test, expect } from '@playwright/test';

test('vertical menu fits mobile and desktop, portraits and profile sections work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/lobby', route => route.fulfill({ json: {
    account: { id: 'self', name: 'NomeMoltoLungoDiProva', xp: 430, kills: 12, deaths: 3, gold: 90 },
    friends: [{ id: 'friend', name: 'AmicoDalNomeLunghissimo', online: true }],
    leaderboard: [{ id: 'self', name: 'NomeMoltoLungoDiProva', xp: 430, kills: 12 }],
  } }));
  await page.goto('/');
  await expect(page.locator('[data-ref="saved-name"]')).toHaveText('NomeMoltoLungoDiProva');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: 'Prepara la tua avventura' })).toBeVisible();
    await expect(page.locator('.class-symbol img')).toHaveCount(3);
    await page.locator('[data-class="warrior"]').click();
    await expect(page.locator('[data-class="warrior"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-ref="class-detail"]')).toContainText('RAGE');
    for (const section of ['friends', 'rankings', 'stats', 'achievements']) {
      await page.locator(`[data-hub="${section}"]`).click();
      await expect(page.locator(`[data-hub-panel="${section}"]`)).toBeVisible();
      const overflow = await page.locator('.lobby').evaluate(root => {
        const bounds = root.getBoundingClientRect();
        return [...root.querySelectorAll<HTMLElement>('*')].filter(node => {
          const rect = node.getBoundingClientRect();
          return rect.width && rect.height && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || node.scrollWidth > node.clientWidth + 2);
        }).map(node => node.className);
      });
      expect(overflow, `${width}px / ${section}`).toEqual([]);
    }
    await expect(page.locator('[data-ref="lobby-stats"]')).toContainText('430');
    await page.locator('[data-hub="friends"]').click();
    await expect(page.locator('[data-ref="lobby-friends"]')).toContainText('AmicoDalNomeLunghissimo');
    await page.screenshot({ path: `test-results/menu-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Opzioni', exact: true }).click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('guest menu and unavailable lobby data have clear states', async ({ page }) => {
  await page.route('**/api/lobby', route => route.fulfill({ json: { account: null, friends: [], leaderboard: [] } }));
  await page.goto('/');
  await expect(page.locator('[data-ref="auth-box"]')).toBeVisible();
  await expect(page.locator('[data-ref="lobby-friends"]')).toContainText('Accedi');
  await page.locator('[data-hub="rankings"]').click();
  await expect(page.locator('[data-ref="lobby-rankings"]')).toContainText('ancora vuota');
  await page.route('**/api/lobby', route => route.fulfill({ status: 503 }));
  await page.locator('[data-ref="refresh-lobby"]').click();
  await expect(page.locator('[data-ref="lobby-data-status"]')).toContainText('Dati non disponibili');
});
