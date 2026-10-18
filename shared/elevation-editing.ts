import { emptyGeometry, subtractRect, type ElevationGeometry, type WorldSurface, type WorldSolid, type WorldStair } from './elevation';
import type { WorldDocument, WorldAsset } from './world-schema';
import type { Vec2 } from './types';

export function tiledStairRect(start: Vec2, end: Vec2, axis: 'x' | 'y', width: number, length = 3) {
  const cross = Math.max(1, Math.round(width)), along = Math.max(2, Math.round(length));
  if (![cross,along].every(Number.isFinite)) throw new Error('Dimensioni scala non valide.');
  return { x: Math.floor(Math.min(start.x,end.x)), y: Math.floor(Math.min(start.y,end.y)),
    width: Math.max(Math.abs(Math.floor(end.x) - Math.floor(start.x)) + 1, axis === 'x' ? along : cross),
    height: Math.max(Math.abs(Math.floor(end.y) - Math.floor(start.y)) + 1, axis === 'x' ? cross : along) };
}

export type GeometryOwner = Pick<WorldDocument, 'geometry'> | Pick<WorldAsset, 'geometry'>;
export type GeometryKind = 'surfaces' | 'solids' | 'stairs';
export type GeometryShape = WorldSurface | WorldSolid | WorldStair;
export function editGeometry(owner: GeometryOwner): ElevationGeometry { return owner.geometry ??= emptyGeometry(); }
/** The chosen PNG supplies the graphics; its two halves belong to the linked floors. */
export function setAssetPassage(asset: WorldAsset, stair: WorldStair): void {
  const g=editGeometry(asset),half=stair.axis==='x'?stair.width/2:stair.height/2;
  g.stairs=g.stairs.filter(s=>s.id!==stair.id);g.stairs.push(stair);
  g.surfaces=g.surfaces.filter(s=>s.id!==`${stair.id}-from`&&s.id!==`${stair.id}-to`);
  // A former wall/deck in this footprint must not obstruct or add floors to the passage.
  g.surfaces=g.surfaces.flatMap(s=>subtractRect(s,stair).map((r,i)=>({...r,id:i===0?s.id:`passage-fragment-${crypto.randomUUID()}`})));
  g.solids=g.solids.flatMap(s=>subtractRect(s,stair).map((r,i)=>({...r,id:i===0?s.id:`passage-fragment-${crypto.randomUUID()}`})));
  for(const second of [false,true])g.surfaces.push({id:`${stair.id}-${second?'to':'from'}`,x:stair.x+(second&&stair.axis==='x'?half:0),y:stair.y+(second&&stair.axis==='y'?half:0),width:stair.axis==='x'?half:stair.width,height:stair.axis==='y'?half:stair.height,elevation:second?stair.to:stair.from,ground:true});
}
/** Linked mass is edited/deleted with its terrain top, without removing lower bridge surfaces. */
export function removeGeometry(owner: GeometryOwner, kind: GeometryKind, id: string): void {
  const g = editGeometry(owner);
  if (kind === 'surfaces') { g.surfaces = g.surfaces.filter(s => s.id !== id); g.solids = g.solids.filter(s => s.id !== `${id}-mass`); }
  else if (kind === 'solids') g.solids = g.solids.filter(s => s.id !== id);
  else {g.stairs = g.stairs.filter(s => s.id !== id);g.surfaces=g.surfaces.filter(s=>s.id!==`${id}-from`&&s.id!==`${id}-to`);}
}
export function updateGeometry(owner: GeometryOwner, kind: GeometryKind, shape: GeometryShape): void {
  const g = editGeometry(owner), list = g[kind] as GeometryShape[];
  const i = list.findIndex(s => s.id === shape.id); if (i < 0) return;
  list[i] = shape;
  if (kind === 'surfaces') {
    const mass = g.solids.find(s => s.id === `${shape.id}-mass`);
    if (mass) Object.assign(mass, { x: shape.x, y: shape.y, width: shape.width, height: shape.height, top: (shape as WorldSurface).elevation });
  }
}
