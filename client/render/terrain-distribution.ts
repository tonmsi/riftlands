import { noise } from './render-primitives';

/** Smooth patch density preserves empty areas without repeating decorations in a bitmap. */
export function grassDetailDensity(tx: number, ty: number): number {
  const gx = Math.floor(tx / 6), gy = Math.floor(ty / 6);
  const smooth = (v: number) => v * v * (3 - 2 * v);
  const u = smooth(tx / 6 - gx), v = smooth(ty / 6 - gy);
  const top = noise(gx, gy, 913) * (1 - u) + noise(gx + 1, gy, 913) * u;
  const bottom = noise(gx, gy + 1, 913) * (1 - u) + noise(gx + 1, gy + 1, 913) * u;
  const patch = top * (1 - v) + bottom * v;
  return .025 + patch * patch * .12;
}

export interface GrassPlantPlacement { x: number; y: number; variant: number; scale: number; }

function grassPlantChance(tx:number,ty:number):number {
  let seed=Math.imul(tx,73856093)^Math.imul(ty,19349663)^5147;
  seed=Math.imul(seed^(seed>>>16),0x45d9f3b);seed=Math.imul(seed^(seed>>>16),0x45d9f3b);
  return ((seed^(seed>>>16))>>>0)/4294967296;
}

/** Slightly denser than the old single tufts; occasional compact groups preserve broad empty patches. */
export function grassPlantPlacements(tx: number, ty: number): GrassPlantPlacement[] {
  if(grassPlantChance(tx,ty)>=grassDetailDensity(tx,ty)*1.06)return [];
  const grouping=noise(tx,ty,967),count=grouping>.97 ? 3 : grouping>.90 ? 2 : 1;
  const x=count===1 ? 12+noise(tx,ty,978)*24 : 19+noise(tx,ty,978)*10;
  const y=count===1 ? 20+noise(tx,ty,981)*20 : 24+noise(tx,ty,981)*10;
  const angle=noise(tx,ty,987)*Math.PI*2;
  return Array.from({length:count},(_,i)=>{
    const turn=angle+(i===2 ? Math.PI*1.2 : 0),radius=i===0?0:7;
    return {x:x+Math.cos(turn)*radius,y:y+Math.sin(turn)*radius*.57,
      variant:Math.floor(noise(tx,ty,992+i)*12),scale:(.59+noise(tx,ty,1006+i)*.18)*(i===0?1:.91)};
  }).sort((a,b)=>a.y-b.y);
}
