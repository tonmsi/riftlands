import { noise } from './render-primitives';

/** Original slender curved grass blades, cached for scattered plants and small groups. */
export class GrassPlantArt {
  private readonly sprites=new Map<string,HTMLCanvasElement>();
  sprite(variant:number,moisture:number,snow=false):HTMLCanvasElement {
    variant=((variant%12)+12)%12;
    const wet=moisture>.55,key=`${variant}:${wet}:${snow}`,cached=this.sprites.get(key);
    if(cached)return cached;
    const canvas=document.createElement('canvas');canvas.width=112;canvas.height=96;
    const ctx=canvas.getContext('2d')!;ctx.scale(4,4);
    const colors=['#6a8652','#809c58','#a7b66b','#779455','#b0bf72'];
    ctx.fillStyle='#34563b18';ctx.beginPath();ctx.ellipse(14,20.8,4.6,1.8,0,0,Math.PI*2);ctx.fill();
    const tall=7+noise(variant,0,351)*5;
    for(let leaf=0;leaf<5;leaf++) {
      const spread=(leaf-2)*(1.4+noise(variant,leaf,357));
      const height=tall*(.6+noise(variant,leaf,361)*.45);
      ctx.beginPath();ctx.moveTo(14,20);
      ctx.quadraticCurveTo(14+spread*.35-1.3,20-height*.55,14+spread,20-height);
      ctx.quadraticCurveTo(14+spread*.5+1,20-height*.28,15.4,20);
      ctx.fillStyle=snow ? (leaf%2?'#728b78':'#9da990') : colors[leaf];ctx.fill();
    }
    this.sprites.set(key,canvas);return canvas;
  }
  draw(ctx:CanvasRenderingContext2D,x:number,y:number,variant:number,moisture:number,scale:number,snow=false):void {
    ctx.drawImage(this.sprite(variant,moisture,snow),x-14*scale,y-20*scale,28*scale,24*scale);
  }
}

export const grassPlantArt=new GrassPlantArt();
