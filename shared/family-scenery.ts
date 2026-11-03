import type { TileKind } from './types';
export type SceneryKind = 'bush'|'plant'|'rock';
export interface FamilyScenery { x:number; y:number; width:number; height:number; tile:SceneryKind; }
export interface SceneryFootprint {width:number;height:number;}
/** One deterministic partition per macro cell, shared by drawing and physics. */
export function familySceneryBlock(tileAt:(x:number,y:number)=>TileKind,left:number,top:number,
  footprints:(kind:SceneryKind,x:number,y:number)=>readonly SceneryFootprint[],
  sameRegion:(x:number,y:number,originX:number,originY:number)=>boolean=()=>true,blockSize=6): FamilyScenery[] {
  const used=new Set<number>(),result:FamilyScenery[]=[];
  const tiles=Array.from({length:blockSize**2},(_,i)=>tileAt(left+i%blockSize,top+Math.floor(i/blockSize)));
  for(let row=0;row<blockSize;row++)for(let col=0;col<blockSize;col++){
    const i=row*blockSize+col,tile=tiles[i];if(used.has(i)||(tile!=='bush'&&tile!=='plant'&&tile!=='rock'))continue;
    const x=left+col,y=top+row;
    const sizes=[...footprints(tile,x,y),{width:1,height:1}].filter(s=>s.width>=1&&s.height>=1&&s.width<=blockSize&&s.height<=blockSize).sort((a,b)=>b.width*b.height-a.width*a.height||b.width-a.width);
    const size=sizes.find(s=>col+s.width<=blockSize&&row+s.height<=blockSize&&Array.from({length:s.width*s.height},(_,n)=>(row+Math.floor(n/s.width))*blockSize+col+n%s.width).every(j=>!used.has(j)&&tiles[j]===tile&&sameRegion(left+j%blockSize,top+Math.floor(j/blockSize),x,y)))!;
    for(let dy=0;dy<size.height;dy++)for(let dx=0;dx<size.width;dx++)used.add((row+dy)*blockSize+col+dx);
    result.push({x,y,...size,tile});
  }
  return result;
}
