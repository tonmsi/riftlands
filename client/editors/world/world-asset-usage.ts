import type { DungeonDefinition } from '../../../shared/dungeons';
import { mapDocument } from '../../../shared/warps';
import { worldDungeons } from '../../../shared/world-validation';
import type { AssetPlacement, WorldDocument } from '../../../shared/world-schema';

export interface AssetUseLocation {
  mapId: string;
  mapName: string;
  placement: AssetPlacement;
  source: 'manual' | 'dungeon';
}
/** Include all project maps and the effective, relocated dungeon placements. */
export function worldAssetUsage(project: WorldDocument, catalog: readonly DungeonDefinition[]): Map<string, AssetUseLocation[]> {
  const result = new Map<string, AssetUseLocation[]>();
  for (const map of [{ id: 'world', name: 'Mondo' }, ...(project.interiors ?? [])]) {
    const document = mapDocument(project, map.id);
    const add = (placement: AssetPlacement, source: AssetUseLocation['source']) => {
      if (!result.has(placement.assetId)) result.set(placement.assetId, []);
      result.get(placement.assetId)!.push({ mapId: map.id, mapName: map.name, placement, source });
    };
    for (const placement of document.placements) add(placement, 'manual');
    for (const dungeon of worldDungeons(document, catalog)) for (const placement of dungeon.assetPlacements ?? [])
      add({ ...placement, id: `dungeon:${dungeon.id}:${placement.id}` }, 'dungeon');
  }
  return result;
}
