import { TILE_SIZE } from './config';
import type { Vec2 } from './types';

export interface DungeonRoom extends Vec2 { id: string; name: string; floor: number; width: number; height: number; tiles?: Vec2[]; }
export interface DungeonWarp { id: string; from: Vec2; to: Vec2; }
/** Tile coordinates, relative to the dungeon's origin. Floors occupy distinct room rectangles. */
export interface DungeonTopology {
  entry: Vec2;
  exit: Vec2;
  worldExit?: Vec2;
  rooms: DungeonRoom[];
  warps: DungeonWarp[];
  shadows: (Vec2 & { width: number; height: number; revealRadius: number })[];
}
export function parseDungeonTopology(raw: unknown, width: number, height: number): DungeonTopology {
  const t = raw as DungeonTopology;
  const fail = (): never => { throw new Error('Stanze, warp o ombre dungeon non validi.'); };
  const point = (p: Vec2) => p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
  const rect = (p: Vec2 & { width: number; height: number }) => point(p) && Number.isInteger(p.width) && Number.isInteger(p.height) && p.width >= 1 && p.height >= 1 && p.x + p.width <= width && p.y + p.height <= height;
  if (!t || !point(t.entry) || !point(t.exit) || !Array.isArray(t.rooms) || !t.rooms.length || t.rooms.length > 64 || !Array.isArray(t.warps) || t.warps.length > 128 || !Array.isArray(t.shadows) || t.shadows.length > 128) fail();
  if (t.worldExit !== undefined && (!t.worldExit || ![t.worldExit.x, t.worldExit.y].every(n => Number.isInteger(n) && Math.abs(n) <= 10_000_000))) fail();
  const ids = new Set<string>();
  for (const r of t.rooms) {
    if (!rect(r) || typeof r.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(r.id) || ids.has(r.id) || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 80 || !Number.isInteger(r.floor) || Math.abs(r.floor) > 99) fail();
    ids.add(r.id);
    if (r.tiles !== undefined) {
      if (!Array.isArray(r.tiles) || !r.tiles.length || r.tiles.length > width * height) fail();
      const seen = new Set<string>();
      for (const p of r.tiles) if (!point(p) || p.x < r.x || p.y < r.y || p.x >= r.x+r.width || p.y >= r.y+r.height || seen.has(`${p.x},${p.y}`) || !seen.add(`${p.x},${p.y}`)) fail();
    }
  }
  const occupied = new Set<string>();
  for (const room of t.rooms) for (const p of dungeonRoomTiles(room)) {
    const key = `${p.x},${p.y}`; if (occupied.has(key)) fail(); occupied.add(key);
  }
  ids.clear();
  for (const w of t.warps) {
    if (!w || typeof w.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(w.id) || ids.has(w.id) || !point(w.from) || !point(w.to) || (w.from.x === w.to.x && w.from.y === w.to.y)) fail();
    ids.add(w.id);
  }
  for (const s of t.shadows) if (!rect(s) || !Number.isFinite(s.revealRadius) || s.revealRadius < 1 || s.revealRadius > 20) fail();
  return { ...(t.worldExit ? { worldExit: { x: t.worldExit.x, y: t.worldExit.y } } : {}), entry: { x: t.entry.x, y: t.entry.y }, exit: { x: t.exit.x, y: t.exit.y }, rooms: t.rooms.map(r => ({ id: r.id, name: r.name, floor: r.floor, x: r.x, y: r.y, width: r.width, height: r.height, ...(r.tiles ? { tiles: r.tiles.map(p => ({ x: p.x, y: p.y })) } : {}) })), warps: t.warps.map(w => ({ id: w.id, from: { x: w.from.x, y: w.from.y }, to: { x: w.to.x, y: w.to.y } })), shadows: t.shadows.map(s => ({ x: s.x, y: s.y, width: s.width, height: s.height, revealRadius: s.revealRadius })) };
}
export function dungeonRoomTiles(room: DungeonRoom): readonly Vec2[] {
  return room.tiles ?? Array.from({ length: room.width * room.height }, (_, i) => ({ x: room.x+i%room.width, y: room.y+Math.floor(i/room.width) }));
}
const roomTileIndexes = new WeakMap<Vec2[], Set<string>>();
export function dungeonRoomContains(room: DungeonRoom, tx: number, ty: number): boolean {
  if (tx < room.x || ty < room.y || tx >= room.x+room.width || ty >= room.y+room.height) return false;
  if (!room.tiles) return true;
  let index = roomTileIndexes.get(room.tiles);
  if (!index) { index = new Set(room.tiles.map(p => `${p.x},${p.y}`)); roomTileIndexes.set(room.tiles, index); }
  return index.has(`${Math.floor(tx)},${Math.floor(ty)}`);
}
export function topologyPosition(origin: Vec2, p: Vec2): Vec2 { return { x: (origin.x + p.x + .5) * TILE_SIZE, y: (origin.y + p.y + .5) * TILE_SIZE }; }
export function dungeonRoomAt(t: DungeonTopology, origin: Vec2, position: Vec2): DungeonRoom | undefined {
  const x = position.x / TILE_SIZE - origin.x, y = position.y / TILE_SIZE - origin.y;
  return t.rooms.find(r => dungeonRoomContains(r, x, y));
}
export function dungeonShadowVisible(t: DungeonTopology, origin: Vec2, observer: Vec2, target: Vec2): boolean {
  const x = target.x / TILE_SIZE - origin.x, y = target.y / TILE_SIZE - origin.y;
  return t.shadows.every(s => x < s.x || y < s.y || x >= s.x + s.width || y >= s.y + s.height || Math.hypot(observer.x - target.x, observer.y - target.y) <= s.revealRadius * TILE_SIZE);
}
