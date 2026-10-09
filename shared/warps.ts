import { TILE_SIZE } from './config';
import type { Vec2 } from './types';
import type { DungeonDefinition } from './dungeons';
import { newWorldDocument, type WorldDocument, type WorldInterior, type WorldWarp } from './world-schema';

export const WARP_RADIUS = TILE_SIZE * .65;
export const WARP_FADE_MS = 280;
export function warpPosition(p: Vec2): Vec2 { return { x: (p.x + .5) * TILE_SIZE, y: (p.y + .5) * TILE_SIZE }; }
export function atWarp(p: Vec2, warp: WorldWarp, extra = 0): boolean {
  const entry = warpPosition(warp.entry); return Math.hypot(p.x - entry.x, p.y - entry.y) <= WARP_RADIUS + extra;
}
/** Authoring a door keeps its two directional runtime links in sync. */
export function setWarpReturn(project: WorldDocument, warp: WorldWarp, enabled: boolean, newId: string): void {
  const links = project.warps ??= [];
  let reverse = links.find(w => w.id === warp.reverseId);
  if (!enabled) {
    if (reverse) project.warps = links.filter(w => w.id !== reverse!.id);
    delete warp.reverseId;
    return;
  }
  if (!reverse) {
    reverse = { id: newId, name: `Ritorno · ${warp.name}`.slice(0, 160), from: warp.to, to: warp.from,
      entry: { ...warp.arrival }, arrival: { ...warp.entry }, activation: warp.activation, reverseId: warp.id };
    links.push(reverse); warp.reverseId = reverse.id;
  } else Object.assign(reverse, { from: warp.to, to: warp.from, entry: { ...warp.arrival }, arrival: { ...warp.entry }, activation: warp.activation });
}
export function mapDocument(project: WorldDocument, id = 'world'): WorldDocument {
  if (id === 'world') return project;
  const map = project.interiors?.find(m => m.id === id);
  if (!map) throw new Error(`Interno non disponibile: ${id}`);
  return { ...map.document, seed: project.seed, assets: project.assets, interiorBounds: { id, name: map.name, width: map.width, height: map.height, pvp: map.pvp ?? false } };
}
export function newDungeonInterior(id: string, dungeon: DungeonDefinition, pvp = false, seed = 734291): WorldInterior {
  const bounds = dungeon.layout.bounds;
  const width = bounds.maxTx - bounds.minTx + 5, height = bounds.maxTy - bounds.minTy + 5;
  if (width > 512 || height > 512) throw new Error('Dungeon troppo grande per un interno: massimo 512 caselle per lato.');
  const map = newInterior(id, dungeon.name, width, height, seed);
  map.kind = 'dungeon'; map.pvp = pvp;
  map.document.dungeons = [{ dungeonId: dungeon.id, x: 2, y: 2 }];
  map.document.spawn = { x: 1, y: 1 };
  return map;
}
export function newInterior(id: string, name: string, width = 24, height = 18, seed = 734291): WorldInterior {
  const document = newWorldDocument(seed);
  document.spawn = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  return { id, name, width, height, document };
}
