import { worldAssetImageBounds, worldAssetVisual, type AssetPlacement, type WorldAsset } from '../../shared/world-schema';

/** Small static thumbnails only: no shadows, animation or full game artwork cache. */
export class MinimapAssets {
  revision = 0;
  private images = new Map<string, HTMLCanvasElement>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private wanted = new Set<string>();
  begin(assets: readonly WorldAsset[]): void {
    this.wanted = new Set([...new Set(assets.filter(a=>worldAssetVisual(a).kind==='image').map(a=>a.image))].slice(0,128));
    for(const [key,bitmap] of this.images)if(!this.wanted.has(key)){bitmap.width=bitmap.height=0;this.images.delete(key);}
  }
  draw(ctx: CanvasRenderingContext2D, asset: WorldAsset, placement: AssetPlacement, startX: number, startY: number, cell: number): void {
    const b = worldAssetImageBounds(asset), x = (placement.x + b.x - startX) * cell, y = (placement.y + b.y - startY) * cell;
    const width = b.width * cell, height = b.height * cell;
    if (placement.bushJs) {
      ctx.fillStyle = '#4b7942';ctx.beginPath();ctx.ellipse(x+width/2,y+height/2,width*.48,height*.42,0,0,Math.PI*2);ctx.fill();return;
    }
    if (worldAssetVisual(asset).kind === 'fire') {
      ctx.fillStyle='#d9a15e';ctx.fillRect(x,y,width,height);return;
    }
    let bitmap = this.images.get(asset.image);
    if (bitmap) {
      this.images.delete(asset.image);this.images.set(asset.image,bitmap);
      ctx.drawImage(bitmap,x,y,width,height);return;
    }
    if (!this.wanted.has(asset.image) || this.pending.has(asset.image) || this.failed.has(asset.image) || this.pending.size >= 4) return;
    this.pending.add(asset.image);
    const image = new Image();image.decoding='async';
    const finish = () => {this.pending.delete(asset.image);image.onload=image.onerror=null;this.revision++;};
    image.onload=()=>{
      try {
        const scale=Math.min(1,128/Math.max(image.naturalWidth,image.naturalHeight));
        bitmap=document.createElement('canvas');bitmap.width=Math.max(1,Math.round(image.naturalWidth*scale));bitmap.height=Math.max(1,Math.round(image.naturalHeight*scale));
        bitmap.getContext('2d')!.drawImage(image,0,0,bitmap.width,bitmap.height);
        if(this.wanted.has(asset.image))this.images.set(asset.image,bitmap);
      }catch{this.failed.add(asset.image);}
      finish();
    };
    image.onerror=()=>{if(this.failed.size>=256)this.failed.delete(this.failed.keys().next().value!);this.failed.add(asset.image);finish();};
    image.src=asset.image;
  }
}
