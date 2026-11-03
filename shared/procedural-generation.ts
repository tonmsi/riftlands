import type { WorldAsset, WorldDocument } from './world-schema';
import type { CliffVariant } from './terrain-cliffs';
import { coordinateHash } from './coordinate-random';

export const PROCEDURAL_KINDS = ['bush', 'plant', 'rock', 'cliff'] as const;
export type ProceduralKind = typeof PROCEDURAL_KINDS[number];
export interface ProceduralRule { id: string; width?: number; height?: number; cliffVariant?: CliffVariant; assets: string[]; }
export interface ProceduralFamily {
  id: string; name: string; temperature: [number, number]; elevation: [number, number];
  /** Transition width: temperature uses 0–1 units, elevation uses levels. */
  temperatureBlend: number; elevationBlend: number; rules: ProceduralRule[];
}
export interface ProceduralSection {
  useJs: boolean; useFamilies: boolean; density: number; spacing: number;
  families: ProceduralFamily[];
}
export type ProceduralSettings = Record<ProceduralKind, ProceduralSection>;
export function defaultProceduralSettings(): ProceduralSettings {
  return Object.fromEntries(PROCEDURAL_KINDS.map(kind => [kind, {
    useJs: false, useFamilies: true, density: kind === 'plant' ? .2 : .35, spacing: 1,
    families: [{ id: 'default', name: 'Predefinita', temperature: [0, 1], elevation: [-128, 127], temperatureBlend: .1, elevationBlend: 1, rules: [{ id: 'any', assets: [] }] }],
  }])) as unknown as ProceduralSettings;
}
/** Resolve legacy catalog assignments without changing the user's document. */
export function worldProceduralSettings(doc: Pick<WorldDocument,'assets'|'cliffAssets'|'procedural'>): ProceduralSettings {
  if(doc.procedural)return doc.procedural;
  const settings=defaultProceduralSettings();
  const bush=doc.assets.find(a=>!a.variantOf&&(a.id==='bush'||a.image==='/world-assets/bush.png'));
  if(bush)settings.bush.families[0].rules[0].assets=doc.assets.filter(a=>a.id===bush.id||a.variantOf===bush.id).map(a=>a.id);
  settings.rock.families[0].rules[0].assets=doc.assets.filter(a=>a.generation.enabled&&a.generation.category==='rocks').map(a=>a.id);
  const cliffs=Object.entries(doc.cliffAssets??{}).map(([variant,id])=>({id:variant,cliffVariant:variant as CliffVariant,assets:[id!]}));
  if(cliffs.length)settings.cliff.families[0].rules=cliffs;
  return settings;
}
export interface ProceduralSample { x: number; y: number; temperature: number; elevation: number; defaultOnly?: boolean; width?: number; height?: number; cliffVariant?: CliffVariant; }
function band(value: number, range: [number, number], blend: number): number {
  const distance = Math.max(range[0] - value, value - range[1], 0);
  if (!distance) return 1;
  if (!blend || distance >= blend) return 0;
  const t = 1 - distance / blend; return t * t * (3 - 2 * t);
}
/** Pure selection shared by rendering and collision geometry; never depends on query order. */
export function proceduralAsset(doc: Pick<WorldDocument, 'assets' | 'procedural' | 'seed'>, kind: ProceduralKind, sample: ProceduralSample): WorldAsset | undefined {
  const section = doc.procedural?.[kind];
  if (!section || section.useJs) return;
  const pool = (family: ProceduralFamily) => {
    const rules = family.rules.filter(r => (!r.cliffVariant || r.cliffVariant === sample.cliffVariant)
      && (sample.width === undefined || r.width === undefined || r.width === sample.width)
      && (sample.height === undefined || r.height === undefined || r.height === sample.height));
    const specificity = (r: ProceduralRule) => Number(sample.width !== undefined && r.width !== undefined) + Number(sample.height !== undefined && r.height !== undefined) + Number(sample.cliffVariant !== undefined && r.cliffVariant !== undefined);
    const max = Math.max(-1, ...rules.map(specificity));
    const ids = new Set(rules.filter(r => specificity(r) === max).flatMap(r => r.assets));
    return doc.assets.filter(a => ids.has(a.id) && (!sample.cliffVariant || !a.animation)
      && (sample.width === undefined || a.columns === sample.width) && (sample.height === undefined || a.rows === sample.height)
      && rules.some(r=>r.assets.includes(a.id)&&(r.width===undefined||r.width===a.columns)&&(r.height===undefined||r.height===a.rows))).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  };
  const root = section.families.find(f => f.id === 'default')!;
  const candidates = section.useFamilies && !sample.defaultOnly ? section.families.filter(f => f.id !== 'default').map(f => ({ f, assets: pool(f), weight: band(sample.temperature, f.temperature, f.temperatureBlend) * band(sample.elevation, f.elevation, f.elevationBlend) })).filter(c => c.weight > 0 && c.assets.length) : [];
  const defaults = pool(root), maximum = Math.max(0, ...candidates.map(c => c.weight));
  if (defaults.length && maximum < 1) candidates.push({ f: root, assets: defaults, weight: 1 - maximum });
  const total = candidates.reduce((sum,c) => sum+c.weight,0);
  if (!total) return defaults.length ? defaults[Math.floor(coordinateHash(sample.x,sample.y,doc.seed+4129)*defaults.length)] : undefined;
  let n = coordinateHash(sample.x,sample.y,doc.seed+8101)*total;
  const chosen = candidates.find(c => (n -= c.weight) < 0) ?? candidates[candidates.length-1];
  return chosen.assets[Math.floor(coordinateHash(sample.x,sample.y,doc.seed+4129)*chosen.assets.length)];
}
