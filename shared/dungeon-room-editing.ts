import type { DungeonDraft } from './dungeon-draft';
import { dungeonRoomContains, dungeonRoomTiles, type DungeonRoom } from './dungeon-topology';
import type { Vec2 } from './types';

export function setDungeonRoomTiles(room: DungeonRoom, points: readonly Vec2[]): void {
  if (!points.length) throw new Error('Una stanza deve conservare almeno una casella.');
  room.tiles = points.map(p => ({ x: p.x, y: p.y }));
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  room.x = Math.min(...xs); room.y = Math.min(...ys);
  room.width = Math.max(...xs)-room.x+1; room.height = Math.max(...ys)-room.y+1;
}
export function roomBrush(draft: DungeonDraft, roomId: string, from: Vec2, to: Vec2, erase: boolean): void {
  const room = draft.topology?.rooms.find(r => r.id === roomId); if (!room) return;
  const tiles = new Map(dungeonRoomTiles(room).map(p => [`${p.x},${p.y}`, p]));
  const n = Math.max(Math.abs(from.x-to.x),Math.abs(from.y-to.y));
  for (let i = 0; i <= n; i++) {
    const ratio = n ? i/n : 1, p = { x: Math.round(from.x+(to.x-from.x)*ratio), y: Math.round(from.y+(to.y-from.y)*ratio) };
    if (p.x < 0 || p.y < 0 || p.x >= draft.width || p.y >= draft.height) continue;
    if (erase) { if (tiles.size > 1) tiles.delete(`${p.x},${p.y}`); }
    else if (!draft.topology!.rooms.some(r => r.id !== room.id && dungeonRoomContains(r,p.x,p.y))) tiles.set(`${p.x},${p.y}`,p);
  }
  setDungeonRoomTiles(room,[...tiles.values()]);
}
export function roomRectangle(draft: DungeonDraft, from: Vec2, to: Vec2, floor: number, roomId?: string): DungeonRoom {
  const t = draft.topology!;
  let room = t.rooms.find(r => r.id === roomId);
  const requested = { x: Math.max(0,Math.min(from.x,to.x)), y: Math.max(0,Math.min(from.y,to.y)), width: Math.abs(to.x-from.x)+1, height: Math.abs(to.y-from.y)+1 };
  if (!room && t.rooms.some(r => r.floor !== floor && dungeonRoomTiles(r).some(p => p.x >= requested.x && p.y >= requested.y && p.x < requested.x+requested.width && p.y < requested.y+requested.height))) {
    // Floors are stored in disjoint regions for the existing authority. The editor centers
    // the allocated room, so drawing a new floor does not require arranging storage by hand.
    let spot: Vec2 | undefined;
    const find = () => {
      for (let y=0;y<=draft.height-requested.height;y++) for (let x=0;x<=draft.width-requested.width;x++) {
        if (!t.rooms.some(r => x < r.x+r.width && x+requested.width > r.x && y < r.y+r.height && y+requested.height > r.y)) return {x,y};
      }
    };
    spot=find();
    if (!spot) {
      const oldWidth=draft.width, oldHeight=draft.height;
      if (oldWidth+requested.width <= 96) draft.width += requested.width;
      else if (oldHeight+requested.height <= 96) draft.height += requested.height;
      else throw new Error('Superficie complessiva piena (96×96): riduci una stanza per liberare spazio.');
      const original=draft.tiles;
      draft.tiles=Array.from({length:draft.width*draft.height},(_,i)=>{ const x=i%draft.width,y=Math.floor(i/draft.width); return x<oldWidth&&y<oldHeight?original[y*oldWidth+x]:'rock'; });
      spot=find();
    }
    if (!spot) throw new Error('Spazio insufficiente per questa stanza.');
    from=spot; to={x:spot.x+requested.width-1,y:spot.y+requested.height-1};
  }
  const points: Vec2[] = [];
  for (let y = Math.max(0,Math.min(from.y,to.y)); y <= Math.min(draft.height-1,Math.max(from.y,to.y)); y++) {
    for (let x = Math.max(0,Math.min(from.x,to.x)); x <= Math.min(draft.width-1,Math.max(from.x,to.x)); x++) {
      if (!t.rooms.some(r => r.id !== room?.id && dungeonRoomContains(r,x,y))) points.push({ x,y });
    }
  }
  if (!points.length) throw new Error('Questo spazio appartiene già a un’altra stanza. Ritaglia prima la sua forma o disegna in uno spazio libero.');
  if (!room) { room = { id: `room-${crypto.randomUUID()}`, name: `Stanza ${t.rooms.length+1}`, floor, x: 0, y: 0, width: 1, height: 1 }; t.rooms.push(room); for (const p of points) draft.tiles[p.y*draft.width+p.x]='path'; }
  setDungeonRoomTiles(room,points); return room;
}
