import { TILE_SIZE } from '../shared/config';
import type { Actor } from '../shared/types';
import type { World } from '../shared/world';
import type { AssetPlacement } from '../shared/world-schema';

/** Local visibility and public PvP visibility are separate from actual hiding. */
export function activeAssetFades(world: World, placement: AssetPlacement, self: Actor | null, publicPlayers: readonly Actor[]): { traversable: boolean; hiding: boolean } {
  const cell = self ? world.authoring.cell(placement, self.x / TILE_SIZE, self.y / TILE_SIZE) : undefined;
  return {
    traversable: cell?.visibility === 'fade' || publicPlayers.some(actor =>
      world.authoring.cell(placement, actor.x / TILE_SIZE, actor.y / TILE_SIZE)?.visibility === 'fade'),
    hiding: cell?.visibility === 'hide-fade',
  };
}
