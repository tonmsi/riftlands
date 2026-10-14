import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

test('both makers load PNG kits, retain existing skins on raising and explicitly restore default walls', { timeout: 45_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage(), errors: string[] = [];
    await page.addInitScript('window.__name = value => value'); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/wall-kit-editors', route => route.fulfill({ contentType: 'text/html', body: '<main id="world"></main><main id="dungeon"><section id="dungeon-section-costruisci"></section></main>' }));
    await page.route('**/terrain-walls/catalog.json', route => route.fulfill({ json: { version: 1, issues: ['Una cartella di prova è incompleta.'], kits: [
      { id: 'wall-roccia', name: 'Roccia PNG', material: 'rock', tileSize: 16, levelHeight: 16 / 3, pixelated: true, parts: { body: { image: '/terrain-walls/wall-roccia/body.png', width: 16, height: 16 } } },
      { id: 'wall-mattoni', name: 'Mattoni PNG', material: 'brick', tileSize: 16, levelHeight: 16 / 3, pixelated: true, parts: { body: { image: '/terrain-walls/wall-mattoni/body.png', width: 16, height: 16 } } },
    ] } }));
    await page.goto(`${server.resolvedUrls!.local[0]}wall-kit-editors`);
    await page.evaluate(async () => {
      const { WorldElevationEditor, SurfaceStroke, elevationControls } = await import('/client/editors/world/elevation-editor.ts' as string);
      const { installDungeonSurfaces } = await import('/client/editors/dungeon/dungeon-surfaces-editor.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { newDungeonDraft } = await import('/shared/dungeon-draft.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const doc = newWorldDocument(); const worldRoot = document.querySelector<HTMLElement>('#world')!; worldRoot.innerHTML = elevationControls;
      const editor = new WorldElevationEditor(worldRoot, (action: () => void) => action(), () => doc, () => new World(doc.seed, 16, 'world', doc, []), () => {});
      const draft = newDungeonDraft(8, 8); draft.tiles.fill('grass'); let tool = 'surface-paint';
      const dungeonRoot = document.querySelector<HTMLElement>('#dungeon')!;
      const dungeon = installDungeonSurfaces(dungeonRoot, { draft: () => draft, change: (action: () => void) => action(), tool: () => tool,
        setTool: (value: string) => { tool = value; }, refresh: () => {}, draw: () => {}, status: () => {} });
      (window as any).__wallKitEditors = { doc, editor, stroke: new SurfaceStroke(doc), draft, dungeon, setTool: (value: string) => { tool = value; } };
    });
    for (const id of ['surface-wall-skin', 'dungeon-wall-skin']) await expect(page.locator(`#${id} option`)).toHaveCount(3);
    await expect(page.locator('#surface-wall-kit-info')).toContainText('incompleta');
    await expect(page.locator('#dungeon-wall-kit-info')).toContainText('incompleta');
    const result = await page.evaluate(() => {
      const { doc, editor, stroke, draft, dungeon, setTool } = (window as any).__wallKitEditors;
      const choose = (id: string, value: string) => { const field = document.querySelector<HTMLSelectElement>(`#${id}`)!; field.value = value; field.dispatchEvent(new Event('change')); };
      choose('surface-wall-skin', 'wall-roccia');
      stroke.paint({ x: 2, y: 3 }, 'height', editor.settings());
      const worldInitial = structuredClone(doc.surfaceCells[0]);
      choose('surface-wall-skin', 'wall-mattoni');
      stroke.paint({ x: 2, y: 3 }, 'raise-height', editor.settings());
      const worldRaised = structuredClone(doc.surfaceCells[0]);
      choose('surface-wall-skin', ''); stroke.paint({ x: 2, y: 3 }, 'height', editor.settings());
      const worldDefault = structuredClone(doc.surfaceCells[0]);
      choose('dungeon-wall-skin', 'wall-roccia'); dungeon.paint({ x: 2, y: 3 }, null); dungeon.finish();
      const dungeonInitial = structuredClone(draft.surfaceCells[0]);
      choose('dungeon-wall-skin', 'wall-mattoni'); setTool('surface-raise'); dungeon.paint({ x: 2, y: 3 }, null); dungeon.finish();
      const dungeonRaised = structuredClone(draft.surfaceCells[0]);
      dungeon.paintMaterial({ x: 2, y: 3 }, 'sand'); dungeon.finish(); const materialPaint = structuredClone(draft.surfaceCells[0]);
      choose('dungeon-wall-skin', ''); setTool('surface-paint'); dungeon.paint({ x: 2, y: 3 }, null); dungeon.finish();
      const dungeonDefault = structuredClone(draft.surfaceCells[0]);
      choose('dungeon-wall-skin', 'wall-roccia'); setTool('surface-raise'); dungeon.paint({ x: 4, y: 3 }, null); dungeon.finish();
      return { worldInitial, worldRaised, worldDefault, dungeonInitial, dungeonRaised, materialPaint, dungeonDefault, dungeonNew: draft.surfaceCells[1] };
    });
    for (const cell of [result.worldInitial, result.dungeonInitial, result.worldRaised, result.dungeonRaised, result.materialPaint, result.dungeonNew]) {
      assert.equal(cell.wallSkin, 'wall-roccia'); assert.equal(cell.wallMaterial, 'rock');
    }
    assert.equal(result.worldRaised.elevation, result.worldInitial.elevation + 1);
    assert.equal(result.dungeonRaised.elevation, result.dungeonInitial.elevation + 1);
    assert.equal(result.materialPaint.material, 'sand');
    assert.equal('wallSkin' in result.worldDefault, false); assert.equal('wallSkin' in result.dungeonDefault, false);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
