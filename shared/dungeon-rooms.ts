import type { Vec2 } from './types';

/** Tile masks are independent of encounter regions and terrain. */
export interface DungeonRoom { id: string; name: string; tiles: Vec2[]; }
export function validDungeonRooms(value: unknown, bounds: { minTx: number; maxTx: number; minTy: number; maxTy: number }): value is DungeonRoom[] {
  if (!Array.isArray(value) || value.length > 64) return false;
  const ids = new Set<string>(), occupied = new Set<string>();
  for (const room of value) {
    if (!room || typeof room.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(room.id) || ids.has(room.id)
      || typeof room.name !== 'string' || !room.name.trim() || room.name.length > 80 || !Array.isArray(room.tiles) || room.tiles.length > 9216) return false;
    ids.add(room.id);
    for (const p of room.tiles) {
      if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < bounds.minTx || p.x > bounds.maxTx || p.y < bounds.minTy || p.y > bounds.maxTy || occupied.has(`${p.x},${p.y}`)) return false;
      occupied.add(`${p.x},${p.y}`);
    }
  }
  return true;
}
export function roomShapeIssues(rooms: readonly DungeonRoom[]): string[] {
  const issues: string[] = [];
  for (const room of rooms) {
    if (!room.tiles.length) { issues.push(`${room.name}: disegna la forma della stanza oppure eliminala.`); continue; }
    const pending = new Set(room.tiles.map(p => `${p.x},${p.y}`)), queue = [room.tiles[0]]; pending.delete(`${queue[0].x},${queue[0].y}`);
    for (let i = 0; i < queue.length; i++) for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const p = { x: queue[i].x + dx, y: queue[i].y + dy }; if (pending.delete(`${p.x},${p.y}`)) queue.push(p);
    }
    if (pending.size) issues.push(`${room.name}: la forma contiene parti separate. Collegale dipingendo altre caselle o crea due stanze.`);
  }
  return issues;
}
