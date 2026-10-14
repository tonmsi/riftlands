import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('both makers author solid continuous 45 degree stairs and explain mismatched banks', { timeout: 45_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage(), errors: string[] = [];
    await page.addInitScript('window.__name = value => value'); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/incline-authoring', route => route.fulfill({ contentType: 'text/html', body: '<main></main><aside><div id="dungeon-section-costruisci"></div></aside><canvas width="400" height="400" style="width:400px;height:400px"></canvas>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}incline-authoring`);
    const result = await page.evaluate(async () => {
      const { WorldElevationEditor, elevationControls } = await import('/client/editors/world/elevation-editor.ts' as string);
      const { installDungeonSurfaces } = await import('/client/editors/dungeon/dungeon-surfaces-editor.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { newDungeonDraft } = await import('/shared/dungeon-draft.ts' as string);
      const { stairGeometry } = await import('/shared/surface-stairs.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const doc = newWorldDocument(); doc.placements = []; doc.npcs = []; doc.surfaceCells = [];
      for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) doc.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
      for (const [y, elevation] of [[3, 3], [8, 1]]) doc.surfaceCells.push({ x: 3, y, elevation, surfaceId: 'ground', material: 'grass', wallMaterial: 'rock', kind: 'ground' });
      const root = document.querySelector('main')!; root.innerHTML = elevationControls;
      let world = new World(doc.seed, 16, 'world', doc, []);
      const editor = new WorldElevationEditor(root, (action: () => void) => { action(); world = new World(doc.seed, 16, 'world', doc, []); }, () => doc, () => world, () => {});
      const select = root.querySelector<HTMLSelectElement>('#surface-stair-profile')!, defaultProfile = select.value;
      select.value = 'incline-45'; select.dispatchEvent(new Event('change'));
      editor.click({ x: 2, y: 3, surfaceId: 'ground' }); editor.hover({ x: 3, y: 3, surfaceId: 'ground' });
      editor.draw(document.querySelector('canvas')!, { x: 0, y: 0, scale: 24 });
      const worldHint = root.querySelector('#surface-link-hint')!.textContent;
      editor.click({ x: 3, y: 3, surfaceId: 'ground' });
      editor.click({ x: 2, y: 8, surfaceId: 'ground' });
      let worldError = ''; try { editor.click({ x: 3, y: 8, surfaceId: 'ground' }); } catch (error) { worldError = String(error); }

      const draft = newDungeonDraft(12, 12); draft.tiles.fill('grass'); draft.encounters = [];
      draft.surfaceCells = structuredClone(doc.surfaceCells.filter((c: { kind: string }) => c.kind === 'ground'));
      let tool = 'surface-link:stairs'; const statuses: string[] = [], dungeonRoot = document.querySelector('aside')!;
      const dungeon = installDungeonSurfaces(dungeonRoot, { draft: () => draft, change: (action: () => void) => action(), tool: () => tool,
        setTool: (value: string) => { tool = value; }, refresh: () => {}, draw: () => {}, status: (value: string) => statuses.push(value) });
      const dungeonSelect = dungeonRoot.querySelector<HTMLSelectElement>('#dungeon-stair-profile')!, dungeonDefault = dungeonSelect.value;
      dungeonSelect.value = 'incline-45'; dungeonSelect.dispatchEvent(new Event('change'));
      dungeon.paint({ x: 2, y: 3, surfaceId: 'ground' }, null); dungeon.hover({ x: 3, y: 3, surfaceId: 'ground' });
      const dungeonHint = dungeonRoot.querySelector('#dungeon-surface-info')!.textContent;
      dungeon.paint({ x: 3, y: 3, surfaceId: 'ground' }, null);
      dungeon.paint({ x: 2, y: 8, surfaceId: 'ground' }, null); dungeon.paint({ x: 3, y: 8, surfaceId: 'ground' }, null);
      const metric = (s: any) => ({ profile: s.profile, landing: stairGeometry(s).landing, angle: stairGeometry(s).angle, solid: s.underpass === false });
      return { defaultProfile, dungeonDefault, worldHint, dungeonHint, worldError, statuses,
        world: doc.surfaceStairs?.map(metric), dungeon: draft.surfaceStairs?.map(metric) };
    });
    assert.equal(result.defaultProfile, 'incline'); assert.equal(result.dungeonDefault, 'incline');
    assert.match(result.worldHint!, /45\.0°.*ingombro 2 celle.*corpo solido/);
    assert.match(result.dungeonHint!, /45\.0°.*ingombro 2 celle.*corpo solido/);
    assert.match(result.worldError, /3 livelli ogni tile/); assert.match(result.statuses.at(-1)!, /3 livelli ogni tile/);
    const expected = [{ profile: 'incline', landing: 0, angle: 45, solid: true }];
    assert.deepEqual(result.world, expected); assert.deepEqual(result.dungeon, expected); assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
