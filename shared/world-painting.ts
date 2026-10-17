import type { TileKind } from './types';

export type PaintMaterial = TileKind | 'stone';
export interface MaterialPaint { color: string; intensity: number; size: number; }
export interface MaskPoint { x: number; y: number; }
/** Interior control points only; shared edge endpoints are supplied by the renderer. */
export interface MaskShape { curves: MaskPoint[][]; smooth: boolean; }
export interface CoastBand { width:number; color:string; opacity:number; softness:number; }
export interface CoastMotion { enabled:boolean; amplitude:number; speed:number; randomness:number; seed:number; bands:CoastBand[]; }
export const defaultCoastMotion=():CoastMotion=>({enabled:true,amplitude:3,speed:.35,randomness:.5,seed:271,
  bands:[{width:24,color:'#c9e8dc',opacity:.12,softness:3},{width:9,color:'#e3f0db',opacity:.2,softness:3}]});
export interface WaterCoast {
  enabled:boolean; automatic:boolean; smoothing:number; noise:number; noiseScale:number; seed:number;
  feather:number; shallows:number; shallowColor:string;
  featherOpacity?:number; shallowOpacity?:number;
  featherSteps?:number; shallowSteps?:number; motion?:CoastMotion;
}
export const DEFAULT_WATER_COAST:Readonly<WaterCoast>={enabled:true,automatic:true,smoothing:1,noise:1.5,noiseScale:8,seed:137,
  feather:4,shallows:14,shallowColor:'#8dcabe',featherOpacity:.94,shallowOpacity:.45};
export const TRANSITION_MATERIALS = ['water', 'grass', 'mud', 'ice', 'path', 'snow', 'stone'] as const;
export type TransitionMaterial = typeof TRANSITION_MATERIALS[number];
export interface TransitionRule {
  curve?: number;
  maskShapes?: Partial<Record<number, MaskShape>>;
  priority?: number;
  owner?: TransitionMaterial;
}
export const TRANSITION_PRIORITY: Record<TransitionMaterial,number> = {water:70,stone:60,snow:50,path:40,ice:30,mud:20,grass:10};
export const transitionPairKey = (a: TransitionMaterial,b: TransitionMaterial): string => [a,b].sort().join(':');
export interface ResolvedTransition {
  source: 'general' | 'material' | 'pair'; key: string; owner?: TransitionMaterial;
  curve: number; maskShapes?: WorldPainting['maskShapes']; priority: number;
}
/** Resolve once per surface combination, outside the frame loop. Pair > material > general.
 * Junctions use one winning rule, ordered by specificity, priority and stable key. */
export function resolveTransition(p: WorldPainting, surfaces: readonly TransitionMaterial[]): ResolvedTransition {
  const unique=[...new Set(surfaces)].sort() as TransitionMaterial[];
  const materialPriority=(s:TransitionMaterial)=>p.materialRules?.[s]?.priority??TRANSITION_PRIORITY[s];
  const candidates: {source:'material'|'pair';key:string;owner:TransitionMaterial;rule:TransitionRule}[]=[];
  for(const s of unique)if(p.materialRules?.[s])candidates.push({source:'material',key:s,owner:s,rule:p.materialRules[s]!});
  for(let i=0;i<unique.length;i++)for(let j=i+1;j<unique.length;j++){
    const a=unique[i],b=unique[j],key=transitionPairKey(a,b),rule=p.pairRules?.[key];
    if(rule){
      const owner=rule.owner??[a,b].sort((x,y)=>materialPriority(y)-materialPriority(x)||x.localeCompare(y))[0];
      candidates.push({source:'pair',key,owner,rule});
    }
  }
  candidates.sort((a,b)=>(b.source==='pair'?2:1)-(a.source==='pair'?2:1)
    ||(b.rule.priority??materialPriority(b.owner))-(a.rule.priority??materialPriority(a.owner))||a.key.localeCompare(b.key));
  const winner=candidates[0];
  if(!winner)return {source:'general',key:'general',curve:p.curve,maskShapes:p.maskShapes,priority:0};
  const base=winner.source==='pair'?p.materialRules?.[winner.owner]:undefined;
  return {source:winner.source,key:winner.key,owner:winner.owner,priority:winner.rule.priority??materialPriority(winner.owner),
    curve:winner.rule.curve??base?.curve??p.curve,
    maskShapes:{...p.maskShapes,...base?.maskShapes,...winner.rule.maskShapes}};
}
export interface WorldPainting {
  /** Visual comparison switches. Missing values preserve existing artwork. */
  seaEnabled?:boolean;
  masksEnabled?:boolean;
  waterCoast?:WaterCoast;
  materialRules?: Partial<Record<TransitionMaterial,TransitionRule>>;
  pairRules?: Partial<Record<string,TransitionRule>>;
  maskShapes?: Partial<Record<number, MaskShape>>;
  edges: 'masks' | 'legacy';
  curve: number;
  materials: Record<PaintMaterial, MaterialPaint>;
}
export const PAINT_COLORS: Record<PaintMaterial, string> = {
  grass: '#91ad69', path: '#cfb47e', water: '#45a0ad', rock: '#8fa2ba',
  bush: '#559b55', mud: '#a09c72', snow: '#eaf4f8', ice: '#8fcee5', stone: '#b7ad90',
};
export function defaultWorldPainting(): WorldPainting {
  return { edges: 'masks', curve: 1, materials: Object.fromEntries(Object.entries(PAINT_COLORS)
    .map(([key, color]) => [key, { color, intensity: 1, size: 1 }])) as WorldPainting['materials'] };
}
/** Bounded data only: painting can never alter terrain, movement or climate. */
export function validWorldPainting(value: unknown): value is WorldPainting {
  if (!value || typeof value !== 'object') return false;
  const p = value as WorldPainting;
  if((p.seaEnabled!==undefined&&typeof p.seaEnabled!=='boolean')||(p.masksEnabled!==undefined&&typeof p.masksEnabled!=='boolean'))return false;
  if(p.waterCoast!==undefined){
    const w=p.waterCoast;
    const range=(v:number,min:number,max:number)=>Number.isFinite(v)&&v>=min&&v<=max;
    if(!w||typeof w!=='object'||typeof w.enabled!=='boolean'||typeof w.automatic!=='boolean'
      ||!range(w.smoothing,0,1)||!range(w.noise,0,6)||!range(w.noiseScale,2,32)
      ||!Number.isInteger(w.seed)||!range(w.seed,0,1_000_000)||!range(w.feather,0,128)
      ||!range(w.shallows,0,512)||!/^#[0-9a-f]{6}$/i.test(w.shallowColor)
      ||(w.featherOpacity!==undefined&&!range(w.featherOpacity,0,1))||(w.shallowOpacity!==undefined&&!range(w.shallowOpacity,0,1)))return false;
    for(const steps of [w.featherSteps,w.shallowSteps])if(steps!==undefined&&(!Number.isInteger(steps)||!range(steps,1,32)))return false;
    if(w.motion!==undefined){
      const m=w.motion;
      if(!m||typeof m!=='object'||typeof m.enabled!=='boolean'||!range(m.amplitude,0,128)||!range(m.speed,0,4)
        ||!range(m.randomness,0,1)||!Number.isInteger(m.seed)||!range(m.seed,0,1_000_000)
        ||!Array.isArray(m.bands)||m.bands.length>12||!m.bands.every(b=>b&&range(b.width,0,512)
          &&/^#[0-9a-f]{6}$/i.test(b.color)&&range(b.opacity,0,1)&&Number.isInteger(b.softness)&&range(b.softness,1,16)))return false;
    }
  }
  const validRule=(r:TransitionRule)=>!!r&&typeof r==='object'&&!Array.isArray(r)
    &&(r.curve===undefined||(Number.isFinite(r.curve)&&r.curve>=0&&r.curve<=1))
    &&(r.priority===undefined||(Number.isInteger(r.priority)&&r.priority>=0&&r.priority<=1000))
    &&(r.owner===undefined||TRANSITION_MATERIALS.includes(r.owner))
    &&validWorldPainting({...defaultWorldPainting(),maskShapes:r.maskShapes});
  for(const [kind,rules] of [['material',p.materialRules],['pair',p.pairRules]] as const){
    if(rules===undefined)continue;
    if(!rules||typeof rules!=='object'||Array.isArray(rules)||Object.keys(rules).length>(kind==='pair'?21:7))return false;
    for(const [key,rule] of Object.entries(rules)){
      if(!validRule(rule!))return false;
      if(kind==='material'){
        if(!TRANSITION_MATERIALS.includes(key as TransitionMaterial)||rule!.owner!==undefined)return false;
      }else{
        const parts=key.split(':') as TransitionMaterial[];
        if(parts.length!==2||parts[0]===parts[1]||!parts.every(s=>TRANSITION_MATERIALS.includes(s))
          ||transitionPairKey(parts[0],parts[1])!==key||(rule!.owner!==undefined&&!parts.includes(rule!.owner)))return false;
      }
    }
  }
  if (p.maskShapes !== undefined) {
    if (!p.maskShapes || typeof p.maskShapes !== 'object' || Array.isArray(p.maskShapes)) return false;
    for (const [key, shape] of Object.entries(p.maskShapes)) {
      const mask = Number(key);
      if (!/^(?:[1-9]|1[0-4])$/.test(key) || !shape || typeof shape.smooth !== 'boolean'
        || !Array.isArray(shape.curves) || shape.curves.length !== (mask === 5 || mask === 10 ? 2 : 1)
        || !shape.curves.every(points => Array.isArray(points) && points.length >= 1 && points.length <= 8
          && points.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
            && point.x >= .03 && point.x <= .97 && point.y >= .03 && point.y <= .97))) return false;
    }
  }
  return ['masks', 'legacy'].includes(p.edges) && Number.isFinite(p.curve) && p.curve >= 0 && p.curve <= 1
    && !!p.materials && Object.keys(PAINT_COLORS).every(key => {
      const m = p.materials[key as PaintMaterial];
      return !!m && /^#[0-9a-f]{6}$/i.test(m.color) && Number.isFinite(m.intensity) && m.intensity >= 0 && m.intensity <= 2
        && Number.isFinite(m.size) && m.size >= .25 && m.size <= 2;
    });
}
