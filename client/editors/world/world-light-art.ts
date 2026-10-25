import type { AssetPlacement, WorldAsset } from '../../../shared/world-schema';
import { worldAssetImageBounds, worldAssetVisual } from '../../../shared/world-schema';
import { TILE_SIZE } from '../../../shared/config';
import { WorldAssetArt } from '../../render/world-asset-art';

/** Editor-only thumbnails: no shadows, fade masks or animated artwork. */
export class WorldLightArt extends WorldAssetArt {
    private thumbnails = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
    constructor(private source: WorldAssetArt) { super(); }
    override image(a: WorldAsset): HTMLCanvasElement | undefined {
        const source = this.source.image(a, false);
        if (!source) return;
        const cached = this.thumbnails.get(source);
        if (cached) return cached;
        const bitmap = document.createElement('canvas');
        const factor = Math.min(1, 64 / Math.max(source.width, source.height));
        bitmap.width = Math.max(1, Math.round(source.width * factor));
        bitmap.height = Math.max(1, Math.round(source.height * factor));
        bitmap.getContext('2d')!.drawImage(source, 0, 0, bitmap.width, bitmap.height);
        this.thumbnails.set(source, bitmap);
        return bitmap;
    }
    override draw(ctx: CanvasRenderingContext2D, a: WorldAsset, p: AssetPlacement, opacity = 1, unit = TILE_SIZE): void {
        const b = worldAssetImageBounds(a), fire = worldAssetVisual(a).kind === 'fire';
        // At distant zoom, keep every object's footprint without decoding tiny PNGs.
        const image = unit >= 6 && !fire && !p.bushJs ? this.image(a) : undefined;
        ctx.save(); ctx.globalAlpha *= opacity;
        if (image) ctx.drawImage(image, (p.x + b.x) * unit, (p.y + b.y) * unit, b.width * unit, b.height * unit);
        else {
            ctx.fillStyle = fire ? '#d39752' : a.cells.some(c => c.blocked) ? '#77766a' : '#64935a';
            ctx.fillRect((p.x + b.x) * unit, (p.y + b.y) * unit, b.width * unit, b.height * unit);
        }
        ctx.restore();
    }
}
