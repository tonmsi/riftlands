import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('both makers default to solid stairs and author a suspended staircase only when selected', { timeout: 45_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage(), errors: string[] = [];
    await page.addInitScript('window.__name = value => value'); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/stairs-authoring', route => route.fulfill({ contentType: 'text/html', body: '<main></main><aside><div id="dungeon-section-costruisci"></div></aside>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}stairs-authoring`);
    const result = await page.evaluate(async () => {
      const { WorldElevationEditor, elevationControls } = await import('/client/editors/world/elevation-editor.ts' as string);
      const { installDungeonSurfaces } = await import('/client/editors/dungeon/dungeon-surfaces-editor.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { newDungeonDraft } = await import('/shared/dungeon-draft.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const doc = newWorldDocument(); doc.surfaceCells = [];
      for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) doc.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
      for (const y of [3, 8]) doc.surfaceCells.push({ x: 6, y, elevation: 3, surfaceId: 'ground', material: 'grass', wallMaterial: 'rock', kind: 'ground' });
      const root = document.querySelector('main')!; root.innerHTML = elevationControls;
      let world = new World(doc.seed, 16, 'world', doc, []), worldDraws = 0;
      const editor = new WorldElevationEditor(root, (action: () => void) => { action(); world = new World(doc.seed, 16, 'world', doc, []); }, () => doc, () => world, () => worldDraws++);
      const worldToggle = root.querySelector<HTMLInputElement>('#surface-stair-underpass')!, worldDefault = worldToggle.checked;
      editor.click({ x: 2, y: 3, surfaceId: 'ground' }); editor.click({ x: 6, y: 3, surfaceId: 'ground' });
      editor.click({ x: 2, y: 8, surfaceId: 'ground' }); editor.hover({ x: 6, y: 8, surfaceId: 'ground' });
      const worldDrawsBefore = worldDraws;
      worldToggle.checked = true; worldToggle.dispatchEvent(new Event('change'));
      const worldRefreshed = worldDraws > worldDrawsBefore;
      editor.click({ x: 6, y: 8, surfaceId: 'ground' });

      const draft = newDungeonDraft(12, 12); draft.tiles.fill('grass'); draft.encounters = [];
      draft.surfaceCells = structuredClone(doc.surfaceCells.filter((c: { kind: string }) => c.kind === 'ground'));
      let dungeonDraws = 0, tool = 'surface-link:stairs'; const statuses: string[] = [];
      const dungeonRoot = document.querySelector('aside')!;
      const dungeon = installDungeonSurfaces(dungeonRoot, { draft: () => draft, change: (action: () => void) => action(),
        tool: () => tool, setTool: (value: string) => { tool = value; }, refresh: () => {}, draw: () => dungeonDraws++, status: (value: string) => statuses.push(value) });
      const dungeonToggle = dungeonRoot.querySelector<HTMLInputElement>('#dungeon-stair-underpass')!, dungeonDefault = dungeonToggle.checked;
      dungeon.paint({ x: 2, y: 3, surfaceId: 'ground' }, null); dungeon.paint({ x: 6, y: 3, surfaceId: 'ground' }, null);
      dungeon.paint({ x: 2, y: 8, surfaceId: 'ground' }, null); dungeon.hover({ x: 6, y: 8, surfaceId: 'ground' });
      const dungeonDrawsBefore = dungeonDraws;
      dungeonToggle.checked = true; dungeonToggle.dispatchEvent(new Event('change'));
      const dungeonRefreshed = dungeonDraws > dungeonDrawsBefore;
      dungeon.paint({ x: 6, y: 8, surfaceId: 'ground' }, null);
      return { worldDefault, dungeonDefault, worldRefreshed, dungeonRefreshed, statuses,
        worldFlags: doc.surfaceStairs?.map((s: { underpass?: boolean }) => s.underpass),
        dungeonFlags: draft.surfaceStairs?.map((s: { underpass?: boolean }) => s.underpass) };
    });
    assert.equal(result.worldDefault, false); assert.equal(result.dungeonDefault, false);
    assert.equal(result.worldRefreshed, true); assert.equal(result.dungeonRefreshed, true);
    assert.deepEqual(result.worldFlags, [false, true]); assert.deepEqual(result.dungeonFlags, [false, true]);
    assert.deepEqual(result.statuses, []); assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
