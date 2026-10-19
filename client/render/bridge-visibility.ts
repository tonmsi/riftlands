import { containsRectPoint, elevationOf, type Elevated, type ElevationRect, type WorldSurface } from '../../shared/elevation';
import { TILE_SIZE } from '../../shared/config';
import type { Vec2 } from '../../shared/types';

export function surfaceOpacity(surface: WorldSurface, viewer?: (Vec2 & Elevated) | null): number {
  return viewer && elevationOf(viewer) < surface.elevation && containsRectPoint(surface, viewer.x / TILE_SIZE, viewer.y / TILE_SIZE) ? .35 : 1;
}

/** Only instances occupying this deck at its own elevation inherit its visual state. */
export function bridgeAssetOpacity(footprint: Omit<ElevationRect, 'id'>, elevation: number, bridges: readonly WorldSurface[]): number {
  return bridges.some(s => !s.ground && s.inheritAssetVisuals !== false && s.elevation === elevation
    && footprint.x < s.x + s.width && footprint.x + footprint.width > s.x
    && footprint.y < s.y + s.height && footprint.y + footprint.height > s.y) ? .35 : 1;
}
