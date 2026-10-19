import { TILE_SIZE } from '../../shared/config';
import { containsRectPoint, elevationOf, type Elevated, type WorldStair } from '../../shared/elevation';
import type { Vec2 } from '../../shared/types';

/** Visual height follows the whole passage; gameplay still uses discrete floors. */
export function cameraElevation(position: Vec2 & Elevated, stairs: readonly WorldStair[]): number {
  const elevation=elevationOf(position),x=position.x/TILE_SIZE,y=position.y/TILE_SIZE;
  const stair=stairs.find(s=>(s.from===elevation||s.to===elevation)&&containsRectPoint(s,x,y));
  if(!stair)return elevation;
  const progress=stair.axis==='x'?(x-stair.x)/stair.width:(y-stair.y)/stair.height;
  return stair.from+(stair.to-stair.from)*Math.max(0,Math.min(1,progress));
}

/** About 3% per floor near ground, bounded even on very tall mountains. */
export function elevationCameraZoom(elevation:number):number {
  return 1-.12*Math.tanh(elevation/4);
}
