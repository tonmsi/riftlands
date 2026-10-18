import type { TileBounds } from './world-authoring';
import type { WorldSurface } from './elevation';

export const CLIFF_VARIANTS = ['alto-sinistra', 'alto-centro', 'alto-destra', 'centro-sinistra', 'centro-destra', 'basso-sinistra', 'basso-centro', 'basso-destra', '90corner-180', '90corner-270'] as const;
export type CliffVariant = typeof CLIFF_VARIANTS[number];
export interface TerrainCliff { x: number; y: number; elevation: number; base: number; inside?: boolean; parts: { variant: CliffVariant }[] }
const variants: CliffVariant[] = ['alto-sinistra', 'alto-centro', 'alto-destra', 'centro-sinistra', 'centro-destra', 'basso-sinistra', 'basso-centro', 'basso-destra'];
const offsets = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

/** Eight-neighbour dilation, clipped to the requested viewport. No world-sized grids. */
export function terrainCliffs(bounds: TileBounds, surfaces: readonly WorldSurface[], baseAt: (x: number, y: number) => number): TerrainCliff[] {
  if (!surfaces.some(s => s.ground && s.painted)) return [];
  bounds = { left: Math.floor(bounds.left), top: Math.floor(bounds.top), right: Math.ceil(bounds.right), bottom: Math.ceil(bounds.bottom) };
  const cells = new Map<string, { level: number; painted: boolean }>();
  const key = (x: number, y: number) => `${x},${y}`;
  for (const s of surfaces) {
    if (!s.ground) continue;
    for (let y = Math.max(Math.floor(bounds.top) - 1, Math.floor(s.y)); y < Math.min(Math.ceil(bounds.bottom) + 1, Math.ceil(s.y + s.height)); y++)
      for (let x = Math.max(Math.floor(bounds.left) - 1, Math.floor(s.x)); x < Math.min(Math.ceil(bounds.right) + 1, Math.ceil(s.x + s.width)); x++) {
        if (x + .5 < s.x || x + .5 >= s.x + s.width || y + .5 < s.y || y + .5 >= s.y + s.height) continue;
        const old = cells.get(key(x, y));
        if (!old || old.level < s.elevation) cells.set(key(x, y), { level: s.elevation, painted: !!s.painted });
        else if (old.level === s.elevation && s.painted) old.painted = true;
      }
  }
  const candidates = new Map<string, { x: number; y: number; level: number }>();
  for (const [position, cell] of cells) {
    if (!cell.painted) continue;
    const [x, y] = position.split(',').map(Number);
    for (const [dx,dy] of offsets) {
      const nx=x+dx, ny=y+dy;
      if(nx<bounds.left||ny<bounds.top||nx>=bounds.right||ny>=bounds.bottom)continue;
      const k=key(nx,ny), base=cells.get(k)?.level??baseAt(nx,ny);
      if(base>=cell.level)continue;
      if((candidates.get(k)?.level??-129)<cell.level)candidates.set(k,{x:nx,y:ny,level:cell.level});
    }
  }
  const result: TerrainCliff[]=[];
  for(const {x,y,level} of candidates.values()) {
    const filled=(dx:number,dy:number)=>(cells.get(key(x+dx,y+dy))?.level??baseAt(x+dx,y+dy))>=level;
    const parts: TerrainCliff['parts']=[];
    // Whole edge sprites take precedence over diagonal corners. Quartering different
    // sprites along a straight face cuts holes into its foot and breaks the joins.
    for (const [dx,dy] of offsets) {
      if (!filled(dx,dy)) continue;
      if (dx && dy && (filled(dx,0) || filled(0,dy))) continue;
      const index = offsets.findIndex(([nx,ny]) => nx === -dx && ny === -dy);
      parts.push({ variant: variants[index] });
    }
    const adjacent = offsets.filter(([dx,dy]) => (!dx || !dy) && filled(dx,dy));
    const inside = adjacent.length === 2 && adjacent[0][0] + adjacent[1][0] !== 0 && adjacent[0][1] + adjacent[1][1] !== 0 && parts.length === 2;
    // Lower inside corners supplied by the artist, where a front face turns into
    // a vertical side. Do not synthesize these from intersected straight sprites.
    if (inside && filled(0,-1)) {
      parts.splice(0, parts.length, { variant: filled(1,0) ? '90corner-180' : '90corner-270' });
    }
    result.push({x,y,elevation:level,base:cells.get(key(x,y))?.level??baseAt(x,y), ...(inside && parts.length > 1 ? { inside: true } : {}),parts});
  }
  return result;
}
