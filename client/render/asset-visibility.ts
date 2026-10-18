import { TILE_SIZE } from '../../shared/config';
import { elevationOf } from '../../shared/elevation';
import type { Actor } from '../../shared/types';
import type { World } from '../../shared/world';
import type { AssetPlacement } from '../../shared/world-schema';

/** Local visibility and public PvP visibility are separate from actual hiding. */
export function activeAssetFades(world: World, placement: AssetPlacement, self: Actor | null, publicPlayers: readonly Actor[]): { traversable: boolean; hiding: boolean } {
  const base = placement.baseElevation ?? world.elevation.terrainElevationAt(placement.x + .5, placement.y + .5);
  const at=(actor:Actor)=>{const cell=world.authoring.cell(placement,actor.x/TILE_SIZE,actor.y/TILE_SIZE);return elevationOf(actor)===base+(cell?.elevation??0)?cell:undefined;};
  const cell = self ? at(self) : undefined;
  return {
    traversable: cell?.visibility === 'fade' || publicPlayers.some(actor => at(actor)?.visibility === 'fade'),
    hiding: cell?.visibility === 'hide-fade',
  };
}
