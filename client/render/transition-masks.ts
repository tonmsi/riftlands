import { resolveTransition, type ResolvedTransition, type TransitionMaterial, type WorldPainting } from '../../shared/world-painting';
import { TerrainMasks } from './terrain-masks';

class CompiledTransition {
  private masks = new TerrainMasks();
  private inverse = new Map<number,Path2D>();
  constructor(readonly rule: ResolvedTransition) {}
  get pathCount():number {return this.masks.pathCount+this.inverse.size;}
  get(bits:number,size:number,upper:readonly TransitionMaterial[]):Path2D {
    const rule=this.rule;
    if(!rule.owner||upper.includes(rule.owner))return this.masks.get(bits,size,rule.curve,rule.maskShapes);
    let path=this.inverse.get(bits);
    if(!path){
      path=new Path2D();path.rect(0,0,size,size);
      path.addPath(this.masks.get(15^bits,size,rule.curve,rule.maskShapes));
      this.inverse.set(bits,path);
    }
    return path;
  }
}
/** At most 91 combinations of 2–4 surfaces. Geometry only, never extra bitmaps.
 * A material rule describes that material's occupied side; the other side uses
 * its exact complement, even when the owner is the underlying sea. */
export class TransitionMasks {
  private painting?:WorldPainting;
  private size=0;
  private combinations=new Map<string,CompiledTransition>();
  private rules=new Map<string,CompiledTransition>();
  private general?:CompiledTransition;
  private overrides=false;
  get stats(){return {combinations:this.combinations.size,rules:this.rules.size,
    paths:[...this.rules.values()].reduce((sum,r)=>sum+r.pathCount,0)};}
  configure(painting:WorldPainting,size:number):void {
    if(this.painting===painting&&this.size===size)return;
    this.painting=painting;this.size=size;this.combinations.clear();this.rules.clear();
    this.general=new CompiledTransition(resolveTransition({...painting,materialRules:undefined,pairRules:undefined},[]));
    this.rules.set('general:general',this.general);
    this.overrides=!!Object.keys(painting.materialRules??{}).length||!!Object.keys(painting.pairRules??{}).length;
  }
  forSurfaces(surfaces:readonly TransitionMaterial[]):CompiledTransition {
    if(!this.overrides)return this.general!;
    const key=surfaces.join(':');
    let compiled=this.combinations.get(key);
    if(!compiled){
      const rule=resolveTransition(this.painting!,surfaces),ruleKey=rule.source+':'+rule.key;
      compiled=this.rules.get(ruleKey);
      if(!compiled){compiled=new CompiledTransition(rule);this.rules.set(ruleKey,compiled);}
      this.combinations.set(key,compiled);
    }
    return compiled;
  }
}
