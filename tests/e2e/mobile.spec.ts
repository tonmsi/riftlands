import { test, expect, type Page } from '@playwright/test';
import type { ClassId, InputCommand, Snapshot } from '../../shared/types';

async function register(page: Page, prefix: string, classId: ClassId = 'paladin'): Promise<void> {
  await page.goto('/'); await page.locator('[data-ref="tab-register"]').click();
  await page.locator('[data-ref="name"]').fill(`${prefix}${Date.now().toString(36)}`);
  await page.locator('[data-ref="password"]').fill('mobile-test-password');
  await page.locator(`[data-class="${classId}"]`).click(); await page.locator('[data-ref="join"]').click();
  await expect(page.locator('.game-hud')).toBeVisible({ timeout: 30000 });
}
async function emulateDeniedFullscreen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).fullscreenCalls = [];
    Element.prototype.requestFullscreen = function(options) {
      (window as any).fullscreenCalls.push({ options, active: navigator.userActivation.isActive });
      return Promise.reject(new Error('Fullscreen unavailable in test'));
    };
  });
}

for (const mobile of [false, true]) {
  test(`location toolbar and expanded map: ${mobile ? 'touch outside dismisses' : 'desktop outside keeps map open'}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: mobile ? 844 : 1440, height: mobile ? 390 : 960 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage(); await emulateDeniedFullscreen(page); await register(page, mobile ? 'TouchMap' : 'DeskMap');
    for (const viewport of mobile ? [{ width: 844, height: 390 }, { width: 568, height: 320 }, { width: 360, height: 640 }] : [{ width: 1440, height: 960 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport);
      const location = page.locator('.world-location');
      const place = (await location.boundingBox())!;
      const fullscreen = (await page.locator('.fullscreen-toggle').boundingBox())!;
      expect(place.y).toBe(fullscreen.y);
      expect(place.x + place.width).toBeLessThanOrEqual(fullscreen.x);
      await expect(location.locator('[data-ref="coords"]')).toBeVisible();
      await expect(location.locator('[data-ref="coords"]')).toHaveText(/^-?\d+ · -?\d+$/);
      if (mobile && viewport.width < viewport.height) {
        const player = (await page.locator('.player-panel').boundingBox())!;
        expect(place.y).toBe(player.y);
      }
      for (const selector of ['.gold-counter', '[data-ref="social-toggle"]', '[data-ref="leave"]']) {
        const box = (await page.locator(selector).boundingBox())!;
        expect(place.x < box.x + box.width && place.x + place.width > box.x && place.y < box.y + box.height && place.y + place.height > box.y).toBe(false);
      }
      if (await location.getAttribute('aria-expanded') === 'false') await location.click();
      const panel = page.locator('.minimap-panel');
      await expect(panel).toBeVisible();
      await expect(panel.locator('.map-heading')).toContainText('LE TERRE DI SOGLIA');
      await expect(panel.locator('[data-ref="map-location"]')).toHaveText('Avamposto del Crocevia');
      const map = (await panel.boundingBox())!;
      expect(map.width).toBeGreaterThan(mobile ? 190 : 250);
      expect(map.x).toBeGreaterThanOrEqual(0); expect(map.y).toBeGreaterThanOrEqual(0);
      expect(map.y + map.height).toBeLessThanOrEqual(viewport.height);
      if (!mobile) expect(Math.round(viewport.height - map.y - map.height)).toBe(24);
      expect(await panel.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
      await expect(panel.locator('.map-coordinates')).toHaveText(await location.locator('[data-ref="coords"]').innerText());
      await panel.locator('.map-heading').click();
      await expect(panel).toBeVisible();
      await page.screenshot({ path: `test-results/expanded-map-${viewport.width}.png` });
      if (mobile) await page.touchscreen.tap(5, viewport.height - 5);
      else await page.mouse.click(5, viewport.height - 5);
      if (mobile) await expect(panel).toBeHidden();
      else { await expect(panel).toBeVisible(); await location.click(); await expect(panel).toBeHidden(); }
    }
    await context.close();
  });
}

test('mobile notices are read in sequence without clipping in either orientation', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 568, height: 320 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  let notice: (message: string) => void = () => { throw new Error('Socket not connected'); };
  await page.routeWebSocket('**/ws', socket => {
    socket.connectToServer();
    notice = message => socket.send(JSON.stringify({ type: 'notice', message, tone: 'info' }));
  });
  // Standalone avoids the fullscreen help notice during this notification test.
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await register(page, 'Notices');
  await expect(page.locator('.toast')).toHaveCount(0);
  const messages = ['Fuori dall’avamposto: PvP attivo.', 'Zona sicura: PvP disattivato.', 'Per giocare senza la barra di Safari: Condividi → Aggiungi alla schermata Home, poi apri Riftlands dalla nuova icona.'];
  messages.forEach(message => notice(message));
  for (let i = 0; i < messages.length; i++) {
    await expect(page.locator('.toast')).toHaveText(messages[i]);
    await expect(page.locator('.toast')).toHaveCount(1);
    if (i === 2) await page.setViewportSize({ width: 360, height: 640 });
    await expect.poll(() => page.locator('.toast').evaluate(toast => {
      const box = toast.getBoundingClientRect();
      const stack = toast.parentElement!.getBoundingClientRect();
      return toast.scrollHeight <= toast.clientHeight && toast.scrollWidth <= toast.clientWidth
        && box.top >= stack.top && box.bottom <= stack.bottom + 1
        && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
    })).toBe(true);
  }
  await context.close();
});

test('iOS fullscreen fallback explains Home Screen launch and standalone skips fullscreen', async ({ browser }) => {
  for (const standalone of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
    const page = await context.newPage();
    await page.addInitScript(value => Object.defineProperty(navigator, 'standalone', { value }), standalone);
    await emulateDeniedFullscreen(page);
    await register(page, standalone ? 'Home' : 'Safari');
    if (standalone) {
      await expect(page.getByRole('button', { name: 'Schermo intero', exact: true })).toBeHidden();
      expect(await page.evaluate(() => (window as any).fullscreenCalls)).toEqual([]);
    } else {
      await expect(page.locator('.toast')).toContainText('Aggiungi alla schermata Home');
    }
    const manifest = await (await page.request.get('/manifest.webmanifest')).json();
    expect(manifest.display).toBe('standalone');
    await context.close();
  }
});

for (const classId of ['mage', 'warrior', 'paladin', 'hunter'] as const) {
  test(`${classId}: non-basic directional skills aim and cast their own slot`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); await emulateDeniedFullscreen(page);
    let snapshot: Snapshot | undefined; const sent: InputCommand[] = [];
    page.on('websocket', socket => {
      socket.on('framesent', frame => { const message = JSON.parse(String(frame.payload)); if (message.type === 'input') sent.push(message.input); });
      socket.on('framereceived', frame => { const message = JSON.parse(String(frame.payload)); if (message.type === 'snapshot') snapshot = message; });
    });
    await register(page, classId, classId);
    await expect.poll(() => snapshot?.self.classId).toBe(classId);
    const directional = classId === 'mage' || classId === 'paladin' ? ['basic', 'q'] : ['basic', 'q', 'e'];
    await expect.poll(() => page.locator('[data-targeting="directional"]').evaluateAll(buttons => buttons.map(button => (button as HTMLElement).dataset.slot))).toEqual(directional);
    const session = await context.newCDPSession(page);
    const stick = (await page.locator('.mobile-joystick').boundingBox())!;
    const move = { id: 1, x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 + 38 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [move] });
    await expect.poll(() => snapshot?.sanctuary).toBe('outside');
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [move] });
    const slots = classId === 'hunter' ? ['q', 'e'] : [classId === 'warrior' ? 'e' : 'q'];
    for (const slot of slots) {
      const button = page.locator(`[data-slot="${slot}"]`);
      await expect(button).toHaveAttribute('aria-disabled', 'false');
      const box = (await button.boundingBox())!;
      const start = { id: 2, x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const end = { ...start, x: start.x - 48 };
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
      await expect(button).toHaveClass(/touch-aiming/);
      await expect.poll(() => sent.at(-1)?.aim ?? 0).toBeCloseTo(Math.PI);
      if (classId === 'mage') await page.screenshot({ path: 'test-results/mobile-ranged-guide.png' });
      const before = sent.length;
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [end] });
      await expect.poll(() => sent.slice(before).filter(command => command.cast === slot).length).toBe(1);
      expect(sent.slice(before).some(command => command.cast === 'basic')).toBe(false);
    }
    await context.close();
  });
}

test('real multi-touch: joystick, aim on attack release, ability taps, cancellation and selection', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let input: InputCommand | undefined, snapshot: Snapshot | undefined; const sent: InputCommand[] = [];
  page.on('websocket', socket => {
    socket.on('framesent', frame => { const message = JSON.parse(String(frame.payload)); if (message.type === 'input') { input = message.input; sent.push(message.input); } });
    socket.on('framereceived', frame => { const message = JSON.parse(String(frame.payload)); if (message.type === 'snapshot') snapshot = message; });
  });
  await emulateDeniedFullscreen(page); await register(page, 'Touch');
  await expect.poll(() => snapshot?.self.id).toBeTruthy();
  expect(await page.evaluate(() => (window as any).fullscreenCalls[0])).toEqual({ options: { navigationUI: 'hide' }, active: true });
  await expect(page.getByRole('button', { name: 'Schermo intero', exact: true })).toBeVisible();
  await expect(page.locator('.minimap-panel')).toBeHidden();
  const otherContext = await browser.newContext(); const other = await otherContext.newPage();
  await register(other, 'Friend');
  await expect.poll(() => snapshot?.actors.some(actor => actor.kind === 'player' && actor.id !== snapshot?.self.id)).toBe(true);
  const friend = snapshot!.actors.find(actor => actor.kind === 'player' && actor.id !== snapshot!.self.id)!;
  await page.touchscreen.tap(422 + (friend.x - snapshot!.self.x) * 0.76, 195 + (friend.y - snapshot!.self.y) * 0.76);
  await expect(page.locator('[data-ref="target-name"]')).toHaveText(friend.name);
  await expect.poll(() => input?.targetId).toBe(friend.id);
  await page.locator('[data-ref="target-close"]').tap();
  await otherContext.close();
  const session = await context.newCDPSession(page);
  const stick = (await page.locator('.mobile-joystick').boundingBox())!;
  const attack = (await page.locator('[data-slot="basic"]').boundingBox())!;
  const center = (box: typeof stick) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const move = { id: 1, x: center(stick).x, y: center(stick).y + 38 };
  const aim = { id: 2, ...center(attack) };
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: { id: number; x: number; y: number }[]) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
  const initialAim = input!.aim;
  await touch('touchStart', [move]);
  await expect.poll(() => input?.dy ?? 0).toBeGreaterThan(0.5);
  expect(input!.aim).toBe(initialAim);
  await expect.poll(() => snapshot?.sanctuary).toBe('outside');
  await touch('touchStart', [move, aim]);
  await touch('touchMove', [move, { ...aim, y: aim.y - 50 }]);
  await expect.poll(() => input?.aim ?? 0).toBeCloseTo(-Math.PI / 2);
  await expect(page.locator('[data-slot="basic"]')).toHaveClass(/touch-aiming/);
  await page.screenshot({ path: 'test-results/mobile-aim.png' });
  const beforeCast = sent.length;
  await touch('touchEnd', [{ ...aim, y: aim.y - 50 }]);
  await expect.poll(() => sent.slice(beforeCast).filter(command => command.cast === 'basic').length).toBe(1);
  expect(sent.slice(beforeCast).find(command => command.cast === 'basic')?.autoAim).toBe(false);
  await expect.poll(() => input?.dy ?? 0).toBeGreaterThan(0.5);
  const shield = center((await page.locator('[data-slot="r"]').boundingBox())!);
  const beforeShield = sent.length;
  await touch('touchStart', [move, { id: 3, ...shield }]); await touch('touchEnd', [{ id: 3, ...shield }]);
  await expect.poll(() => sent.slice(beforeShield).filter(command => command.cast === 'r').length).toBe(1);
  expect(input!.aim).toBeCloseTo(-Math.PI / 2);
  await expect.poll(() => input?.autoAim).toBe(true);
  await expect(page.locator('[data-slot="basic"]')).toHaveAttribute('aria-disabled', 'false');
  const beforeTap = sent.length;
  await touch('touchStart', [move, aim]); await touch('touchEnd', [aim]);
  await expect.poll(() => sent.slice(beforeTap).some(command => command.cast === 'basic' && command.autoAim === true)).toBe(true);
  await touch('touchStart', [move, aim]);
  await touch('touchMove', [move, { ...aim, x: aim.x - 45 }]);
  const beforeCancel = sent.length;
  await touch('touchCancel', []); await expect.poll(() => input?.dy).toBe(0);
  await expect(page.locator('.touch-pressed')).toHaveCount(0);
  expect(sent.slice(beforeCancel).some(command => command.cast === 'basic')).toBe(false);
  await touch('touchStart', [move]); await expect.poll(() => input?.dy ?? 0).toBeGreaterThan(0.5);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => input?.dy).toBe(0); await touch('touchCancel', []);
  await page.evaluate(() => history.back());
  await expect(page.getByRole('heading', { name: 'Tornare al menu?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continua a giocare' }).tap();
  await expect(page.locator('.game-hud')).toBeVisible();
  await page.evaluate(() => history.back());
  await page.getByRole('dialog').getByRole('button', { name: 'Torna al menu', exact: true }).tap();
  await expect(page.locator('.lobby')).toBeVisible();
  expect(await page.locator('html').getAttribute('class')).not.toContain('game-active');
  expect(errors).toEqual([]); await context.close();
});

test('fullscreen success requests landscape and exits cleanly with the game', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    let fullscreen: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { get: () => fullscreen });
    Element.prototype.requestFullscreen = async function() { fullscreen = this; document.dispatchEvent(new Event('fullscreenchange')); };
    document.exitFullscreen = async () => { fullscreen = null; document.dispatchEvent(new Event('fullscreenchange')); };
    Object.defineProperty(screen.orientation, 'lock', { value: async (orientation: string) => { (window as any).requestedOrientation = orientation; } });
    Object.defineProperty(screen.orientation, 'unlock', { value: () => { (window as any).orientationUnlocked = true; } });
  });
  await register(page, 'Full');
  await expect.poll(() => page.evaluate(() => (window as any).requestedOrientation)).toBe('landscape');
  await expect(page.getByRole('button', { name: 'Schermo intero', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Torna al menu', exact: true }).tap();
  await page.getByRole('dialog').getByRole('button', { name: 'Torna al menu', exact: true }).tap();
  await expect(page.locator('.lobby')).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  expect(await page.evaluate(() => (window as any).orientationUnlocked)).toBe(true);
  await context.close();
});

test('desktop minimap preference persists across reload without enabling touch controls', async ({ page }) => {
  await register(page, 'Map');
  await expect(page.locator('.mobile-joystick')).toBeHidden();
  await expect(page.locator('.minimap-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Nascondi mappa', exact: true }).click();
  await expect(page.locator('.minimap-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Torna al menu', exact: true }).click();
  await page.reload(); await page.locator('[data-ref="join"]').click();
  await expect(page.locator('.game-hud')).toBeVisible();
  await expect(page.locator('.minimap-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Mostra mappa', exact: true }).click();
  await expect(page.locator('.minimap-panel')).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-desktop-regression.png' });
});

test('responsive HUD and canvases stay usable across portrait, landscape and tablet', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage(); await emulateDeniedFullscreen(page); await register(page, 'Layout');
  const selectors = ['.player-panel', '.menu-buttons', '.mobile-joystick', '[data-slot="basic"]', '[data-slot="q"]', '[data-slot="e"]', '[data-slot="r"]'];
  for (const viewport of [{ width: 844, height: 390 }, { width: 568, height: 320 }, { width: 390, height: 844 }, { width: 360, height: 640 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.locator('.world-canvas').evaluate(canvas => Math.round(canvas.getBoundingClientRect().height))).toBe(viewport.height);
    const boxes = await Promise.all(selectors.map(selector => page.locator(selector).boundingBox()));
    for (const box of boxes) {
      expect(box).toBeTruthy(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const x = boxes[a]!, y = boxes[b]!;
      expect(x.x < y.x + y.width && x.x + x.width > y.x && x.y < y.y + y.height && x.y + x.height > y.y, `${selectors[a]} overlaps ${selectors[b]} at ${viewport.width}x${viewport.height}`).toBe(false);
    }
    await page.getByRole('button', { name: 'Mostra mappa', exact: true }).tap();
    await expect(page.locator('.minimap-panel')).toBeVisible();
    await expect(page.locator('[data-ref="map-ping"]')).toBeVisible();
    await expect(page.locator('[data-ref="map-ping"]')).toHaveText(/\d+ ms/);
    await expect.poll(() => page.locator('.minimap').evaluate((canvas: HTMLCanvasElement) => canvas.width === Math.round(canvas.getBoundingClientRect().width * 2))).toBe(true);
    await page.screenshot({ path: `test-results/mobile-${viewport.width}x${viewport.height}.png` });
    await page.touchscreen.tap(5, viewport.height - 5);
  }
  await context.close();
});
