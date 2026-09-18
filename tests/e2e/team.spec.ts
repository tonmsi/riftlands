import { test, expect, type Page } from '@playwright/test';
import type { Snapshot } from '../../shared/types';

async function register(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.locator('[data-ref="tab-register"]').click();
  await page.locator('[data-ref="name"]').fill(name);
  await page.locator('[data-ref="password"]').fill('team-test-password');
  await page.locator('[data-ref="join"]').click();
  await expect(page.locator('.game-hud')).toBeVisible();
}

test('team popup consent, live health, scrollable mobile roster and automatic dissolution', async ({ browser }) => {
  const contexts = await Promise.all(Array.from({ length: 5 }, (_, i) => browser.newContext(i === 1
    ? { viewport: { width: 568, height: 320 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 900 } })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const names = pages.map((_, i) => `Team${i}${Date.now().toString(36)}`);
  const errors: string[] = [];
  for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  }
  const [leader, mobile] = pages;
  let leaderSnapshot: Snapshot | undefined;
  leader.on('websocket', socket => socket.on('framereceived', frame => {
    const message = JSON.parse(String(frame.payload));
    if (message.type === 'snapshot') leaderSnapshot = message;
  }));
  let injured = false;
  await mobile.routeWebSocket('**/ws', socket => {
    const server = socket.connectToServer();
    server.onMessage(data => {
      const message = JSON.parse(String(data));
      if (injured && message.type === 'snapshot') {
        const actor = message.actors.find((actor: { id: string }) => actor.id === leaderSnapshot?.self.id);
        if (actor) actor.hp = 37;
      }
      socket.send(JSON.stringify(message));
    });
  });
  try {
    for (let i = 0; i < pages.length; i++) await register(pages[i], names[i]);
    await leader.locator('[data-ref="social-toggle"]').click();
    const invite = async (i: number) => {
      const nearby = leader.locator('.social-section').filter({ has: leader.getByRole('heading', { name: /^Nelle vicinanze/ }) });
      await nearby.locator('.social-row').filter({ hasText: names[i] }).getByRole('button', { name: '+ Team', exact: true }).click();
      await expect(pages[i].locator('.team-invite')).toContainText(`${names[0]} ti ha invitato nel suo team`);
    };
    await invite(1);
    await expect(mobile.locator('.social-panel')).toBeHidden();
    expect(leaderSnapshot?.self.teamId).toBeNull();
    const popup = (await mobile.locator('.team-invite').boundingBox())!;
    for (const selector of ['.mobile-joystick', '[data-slot="basic"]', '[data-slot="q"]', '[data-slot="e"]', '[data-slot="r"]']) {
      const control = (await mobile.locator(selector).boundingBox())!;
      expect(popup.x < control.x + control.width && popup.x + popup.width > control.x && popup.y < control.y + control.height && popup.y + popup.height > control.y, `invite overlaps ${selector}`).toBe(false);
    }
    await mobile.screenshot({ path: 'test-results/team-invite-mobile.png' });
    await mobile.locator('.team-invite').getByRole('button', { name: 'Rifiuta', exact: true }).click();
    await expect(mobile.locator('.team-invite')).toBeHidden();
    await expect(leader.locator('.team-roster')).toBeHidden();
    for (let i = 1; i < pages.length; i++) {
      await invite(i);
      await pages[i].locator('.team-invite').getByRole('button', { name: 'Accetta', exact: true }).click();
      await expect(pages[i].locator('.team-invite')).toBeHidden();
      await expect(leader.locator('.team-member')).toHaveCount(i);
    }
    await expect(mobile.locator('.team-member')).toHaveCount(4);
    injured = true;
    await expect(mobile.locator('.team-member').filter({ hasText: names[0] }).locator('.team-member-health')).toHaveText(/^37 \/ \d+ PV$/);
    for (const size of [{ width: 568, height: 320 }, { width: 844, height: 390 }, { width: 360, height: 640 }]) {
      await mobile.setViewportSize(size);
      const list = (await mobile.locator('.player-details').boundingBox())!;
      const joystick = (await mobile.locator('.mobile-joystick').boundingBox())!;
      expect(list.y + list.height).toBeLessThan(joystick.y);
      if (size.width > size.height) {
        expect(await mobile.locator('.player-details').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
        await mobile.locator('.player-details').evaluate(element => { element.scrollTop = element.scrollHeight; });
        expect(await mobile.locator('.player-details').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      }
      await mobile.screenshot({ path: `test-results/team-roster-${size.width}.png` });
    }
    for (const page of pages.slice(1)) {
      await page.locator('[data-ref="social-toggle"]').click();
      await page.getByRole('button', { name: 'Lascia il team', exact: true }).click();
      await expect(page.locator('.team-roster')).toBeHidden();
    }
    await expect(leader.locator('.team-roster')).toBeHidden();
    await expect.poll(() => leaderSnapshot?.self.teamId).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
