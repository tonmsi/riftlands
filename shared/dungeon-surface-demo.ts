import { newDungeonDraft, type DungeonDraft } from './dungeon-draft';
import { BASE_SURFACE } from './world-surfaces';

/** An editable, uninstalled sample; loading it never mutates the installed catalog. */
export function newSurfaceDemoDungeon(): DungeonDraft {
  const draft = newDungeonDraft(24, 18);
  draft.id = 'demo-alture-ponte'; draft.name = 'Prova · alture naturali, mattoni e ponte'; draft.encounters = [];
  draft.tiles = draft.tiles.map((tile, i) => tile === 'rock' ? tile : Math.floor(i / draft.width) === 7 ? 'path' : 'grass');
  draft.tiles[7 * draft.width] = 'path';
  for (let y = 4; y <= 10; y++) for (let x = 8; x <= 13; x++) draft.tiles[y * draft.width + x] = y === 7 ? 'path' : 'water';
  for (let y = 4; y <= 10; y++) draft.tiles[y * draft.width + 10] = 'path';
  draft.surfaceCells = [];
  for (let y = 5; y <= 9; y++) for (let x = 4; x <= 17; x++) {
    const bridge = x >= 8 && x <= 13; if (bridge && (y < 6 || y > 8)) continue;
    draft.surfaceCells.push({ x, y, surfaceId: bridge ? 'bridge-demo' : BASE_SURFACE, elevation: 2,
      kind: bridge ? 'bridge' : 'ground', material: bridge ? 'wood' : x < 8 ? 'grass' : 'stone', wallMaterial: x < 8 ? 'rock' : 'brick' });
  }
  draft.surfaceLinks = [
    { id: 'demo-stairs', kind: 'stairs', from: { x: 3, y: 7, surfaceId: BASE_SURFACE }, to: { x: 4, y: 7, surfaceId: BASE_SURFACE } },
    { id: 'demo-bridge-left', kind: 'bridge-entry', from: { x: 7, y: 7, surfaceId: BASE_SURFACE }, to: { x: 8, y: 7, surfaceId: 'bridge-demo' } },
    { id: 'demo-bridge-right', kind: 'bridge-entry', from: { x: 13, y: 7, surfaceId: 'bridge-demo' }, to: { x: 14, y: 7, surfaceId: BASE_SURFACE } },
    { id: 'demo-ramp', kind: 'ramp', from: { x: 17, y: 7, surfaceId: BASE_SURFACE }, to: { x: 18, y: 7, surfaceId: BASE_SURFACE } },
  ];
  draft.entities = [
    { id: 'below', kind: 'pickup', template: 'heal', label: 'Bonus sotto il ponte', x: 10, y: 7, level: 1, radius: 12 },
    { id: 'above', kind: 'pickup', template: 'power', label: 'Bonus sopra il ponte', x: 10, y: 7, surfaceId: 'bridge-demo', elevation: 2, level: 1, radius: 12 },
  ];
  return draft;
}
