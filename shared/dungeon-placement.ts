import { TILE_SIZE } from './config';
import { DUNGEON_DEFINITIONS, type DungeonDefinition } from './dungeons';
import { OUTPOST } from './outpost';
import type { Vec2 } from './types';
export function dungeonOriginAt(center: Vec2, width: number, height: number): Vec2 {
    return { x: Math.round(center.x / TILE_SIZE - width / 2), y: Math.round(center.y / TILE_SIZE - height / 2) };
}
export function dungeonPlacementIssue(origin: Vec2, width: number, height: number, existing: readonly DungeonDefinition[] = DUNGEON_DEFINITIONS): string | undefined {
    if (![origin.x, origin.y].every(n => Number.isInteger(n) && Math.abs(n) < 100000))
        return 'Posizione oltre i limiti consentiti.';
    const center = { x: (origin.x + width / 2) * TILE_SIZE, y: (origin.y + height / 2) * TILE_SIZE };
    const radius = Math.hypot(width, height) * TILE_SIZE / 2;
    if (Math.hypot(center.x - OUTPOST.x, center.y - OUTPOST.y) < radius + OUTPOST.clearingRadius + 96)
        return 'Troppo vicino all’avamposto e all’ingresso arena.';
    for (const other of existing)
        if (Math.hypot(center.x - other.area.x, center.y - other.area.y) < radius + other.area.radius + 192)
            return `Mappa troppo vicina o sovrapposta a ${other.name}.`;
    return undefined;
}
