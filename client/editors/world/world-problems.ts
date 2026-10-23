import type { Vec2 } from '../../../shared/types';
import type { WorldDocument } from '../../../shared/world-schema';

export interface WorldIssueLocation {
  mapId: string; point: Vec2; elevation: number;
  kind?: 'placement'|'npc'|'zone'|'warp'|'surfaces'|'solids'|'stairs'; id?: string;
}
/** Only attach a target when the validator message identifies one unambiguously. */
export function locateWorldIssue(project: WorldDocument, message: string): WorldIssueLocation | undefined {
  const interior=(project.interiors??[]).filter(m=>message.startsWith(`${m.name}: `)).sort((a,b)=>b.name.length-a.name.length)[0];
  const mapId=interior?.id??'world', doc=interior?.document??project;
  const text=interior?message.slice(interior.name.length+2):message;
  const warps=(project.warps??[]).filter(w=>message.startsWith(`${w.name}: `));
  if(warps.length===1){const w=warps[0], arrival=text.includes('arrivo ');return{mapId:arrival?w.to:w.from,point:arrival?w.arrival:w.entry,elevation:(arrival?w.arrivalElevation:w.entryElevation)??0,kind:'warp',id:w.id};}
  const npcs=doc.npcs.filter(n=>text.startsWith(`NPC ${n.id} `));
  if(npcs.length===1)return{mapId,point:npcs[0],elevation:npcs[0].elevation??0,kind:'npc',id:npcs[0].id};
  if(text.startsWith('Spawn del giocatore')||text.startsWith('Spawn globale')||text.startsWith('Lo spawn'))return{mapId,point:doc.spawn,elevation:doc.spawnElevation??0};
  for(const kind of ['surfaces','solids','stairs'] as const)for(const shape of doc.geometry?.[kind]??[]){
    if(text.startsWith(`Scala ${shape.id}:`)||text.endsWith(`: ${shape.id}.`))return{mapId,point:shape,elevation:'elevation'in shape?shape.elevation:'base'in shape?shape.base:shape.from,kind,id:shape.id};
  }
  const zones=doc.zones.filter(z=>text.startsWith(`${z.name}:`));
  if(zones.length===1)return{mapId,point:zones[0].shape,elevation:0,kind:'zone',id:zones[0].id};
  return interior?{mapId,point:doc.spawn,elevation:doc.spawnElevation??0}:undefined;
}
