import { TILE_SIZE } from '../../shared/config';
import type { Actor } from '../../shared/types';
import type { World } from '../../shared/world';
import type { AssetPlacement } from '../../shared/world-schema';

/** Local visibility and public PvP visibility are separate from actual hiding. */
export function activeAssetFades(world: World, placement: AssetPlacement, self: Actor | null, publicPlayers: readonly Actor[]): { traversable: boolean; hiding: boolean } {
  const point = { ...placement, x: placement.x * TILE_SIZE, y: placement.y * TILE_SIZE };
  const surface = world.surfaceIndex.at(Math.floor(placement.x), Math.floor(placement.y), placement.surfaceId), level = point.elevation ?? surface?.elevation ?? 0;
  const eligible = (actor: Actor) => surface?.kind === 'bridge' ? world.elevationAt(actor) < level : world.elevationAt(actor) === level;
  const cell = self && eligible(self) ? world.authoring.cell(placement, self.x / TILE_SIZE, self.y / TILE_SIZE) : undefined;
  return {
    traversable: cell?.visibility === 'fade' || publicPlayers.some(actor => eligible(actor) &&
      world.authoring.cell(placement, actor.x / TILE_SIZE, actor.y / TILE_SIZE)?.visibility === 'fade'),
    hiding: cell?.visibility === 'hide-fade',
  };
}
