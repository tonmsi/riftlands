import type { AssetShadow } from '../../shared/world-schema';

/** Transparent raster, generated once per artwork/settings combination, never in the frame loop. */
export function rasterizeAssetShadow(width: number, height: number, shadow: AssetShadow, source: CanvasImageSource): HTMLCanvasElement {
  const bitmap = document.createElement('canvas');
  bitmap.width = width; bitmap.height = height;
  if (!shadow.width || !shadow.height || !shadow.opacity) return bitmap;
  const ctx = bitmap.getContext('2d')!;
  ctx.save();
  if (shadow.kind === 'silhouette') {
    const tint = document.createElement('canvas'); tint.width = width; tint.height = height;
    const paint = tint.getContext('2d')!; paint.drawImage(source, 0, 0, width, height);
    paint.globalCompositeOperation = 'source-in'; paint.fillStyle = '#243025'; paint.fillRect(0, 0, width, height);
    ctx.globalAlpha = shadow.opacity;
    ctx.filter = `blur(${shadow.softness * Math.min(width, height) * .04}px)`;
    ctx.translate(shadow.x * width, shadow.y * height);
    ctx.transform(shadow.width, 0, -shadow.skew, shadow.height, 0, 0);
    ctx.drawImage(tint, -width / 2, -height);
    ctx.restore();
    return bitmap;
  }
  ctx.translate(shadow.x * width, shadow.y * height);
  ctx.scale(shadow.width * width / 2, shadow.height * height / 2);
  const color = `rgba(36,48,37,${shadow.opacity})`;
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, color);
  gradient.addColorStop(Math.min(.999, 1 - shadow.softness), color);
  gradient.addColorStop(1, 'rgba(36,48,37,0)');
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  return bitmap;
}
