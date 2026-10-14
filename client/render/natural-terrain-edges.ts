import { TILE_SIZE } from '../../shared/config';
import { noise } from './render-primitives';
import { shoreCurve, shorePoint, sampleShoreCurve, type ShoreCurve } from './water-shore';
import type { WaterBankStyle } from './environment-art';

type EdgeDirection = readonly [number, number];
interface NaturalEdge {
  tx: number; ty: number; x: number; y: number; direction: EdgeDirection;
  paint: string | CanvasPattern; cold?: boolean; moisture?: number; trimStart?: number; trimEnd?: number; softRoad?: boolean;
}
export const SOFT_PATH_CORNER = 22;

/** Small world-anchored edge shapes and plants, painted into the terrain's existing bitmap cache. */
export class NaturalTerrainEdges {
  private readonly plants = new Map<string, HTMLCanvasElement>();
  path(ctx:CanvasRenderingContext2D,tx:number,ty:number,corner:number,curve:ShoreCurve,moisture:number,cold:boolean):void {
    const chance=noise(tx,ty,821+corner);if(cold || chance<.84)return;
    const p=sampleShoreCurve(curve,.25+noise(tx,ty,832+corner)*.5),length=Math.hypot(p.dx,p.dy)||1;
    const nx=-p.dy/length,ny=p.dx/length,size=.55+chance*.12;
    const plant=this.plant(Math.floor(chance*12),moisture,false);
    ctx.drawImage(plant,p.x-nx*1.5-14*size,p.y-ny*1.5-20*size,28*size,24*size);
  }
  water(ctx: CanvasRenderingContext2D, tx: number, ty: number, x: number, y: number, mask: number,
    banks: readonly WaterBankStyle[], moisture: number, cold: boolean, curves?: readonly (ShoreCurve | undefined)[]): void {
    if (!mask) return;
    const variant = Math.floor(noise(tx, ty) * 6) % 6;
    for (let corner = 0; corner < 4; corner++) {
      const curve = curves ? curves[corner] : shoreCurve(mask, corner, variant / 5), style = banks[corner];
      if (!curve || style.kind === 'frozen') continue;
      const chance = noise(tx, ty, 450 + corner), t = .28 + noise(tx, ty, 460 + corner) * .44;
      const point = shorePoint(curve, t, curves ? 0 : corner), raised = style.kind === 'raised';
      if (!cold && style.kind !== 'rock' && chance > (raised ? .72 : .65)) {
        const reed = !raised && chance > .82;
        const size = reed ? .9 + chance * .25 : .7 + chance * .15;
        const plant = this.plant(Math.floor(chance * 12), moisture, reed);
        const offset = raised ? -4 : reed ? 2 : -2;
        const px = x + point.x + point.nx * offset, py = y + point.y + point.ny * offset;
        ctx.drawImage(plant, px - 14 * size, py - 20 * size, 28 * size, 24 * size);
      }
      if (chance > .86) {
        const px = x + point.x + point.nx * 6, py = y + point.y + point.ny * 6;
        const radius = 2.4 + chance * 1.7;
        // Half-submerged stones sit in the shallow strip and receive a waterline.
        ctx.strokeStyle = '#c6e5d570'; ctx.lineWidth = .8; ctx.beginPath();
        ctx.ellipse(px, py + 1.2, radius + 2.4, radius * .55 + 1.1, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#344f4c55'; ctx.beginPath(); ctx.ellipse(px + .4, py + 1, radius, radius * .65, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8b9480'; ctx.beginPath(); ctx.ellipse(px, py - .4, radius, radius * .65, -.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#bfc3a2'; ctx.beginPath(); ctx.ellipse(px - .8, py - 1.2, radius * .65, radius * .35, -.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  private axes(edge: NaturalEdge): { x: number; y: number; dx: number; dy: number; nx: number; ny: number } {
    const [nx, ny] = edge.direction;
    return { x: edge.x + (nx > 0 ? TILE_SIZE : 0), y: edge.y + (ny > 0 ? TILE_SIZE : 0), dx: ny ? 1 : 0, dy: nx ? 1 : 0, nx, ny };
  }
  private ribbon(ctx: CanvasRenderingContext2D, edge: NaturalEdge, depth: number, salt: number, color: string | CanvasPattern): void {
    const a = this.axes(edge), start = edge.trimStart ?? 0, end = TILE_SIZE - (edge.trimEnd ?? 0);
    if (end <= start) return;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = start + (end - start) * i / 8;
      // The endpoint seeds use the same world vertex on both neighboring tiles.
      const sx = edge.tx * TILE_SIZE + (a.x - edge.x) + a.dx * t;
      const sy = edge.ty * TILE_SIZE + (a.y - edge.y) + a.dy * t;
      const width = depth * (.42 + noise(Math.round(sx), Math.round(sy), salt) * .58);
      const taper = Math.min(1, edge.trimStart ? (t - start + 2) / 5 : 1, edge.trimEnd ? (end - t + 2) / 5 : 1);
      points.push({ x: a.x + a.dx * t + a.nx * width * taper, y: a.y + a.dy * t + a.ny * width * taper });
    }
    ctx.beginPath();
    ctx.moveTo(a.x + a.dx * start - a.nx, a.y + a.dy * start - a.ny);
    ctx.lineTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1], next = points[i];
      ctx.quadraticCurveTo(previous.x, previous.y, (previous.x + next.x) / 2, (previous.y + next.y) / 2);
    }
    const last = points[points.length - 1]; ctx.lineTo(last.x, last.y);
    ctx.lineTo(a.x + a.dx * end - a.nx, a.y + a.dy * end - a.ny); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }
  land(ctx: CanvasRenderingContext2D, edge: NaturalEdge): void {
    ctx.save();
    if (edge.softRoad) {
      const alpha = ctx.globalAlpha;
      // A shared irregular silhouette fades grass into the dirt rather than
      // ending in a sharp opaque strip. The pattern stays anchored to the world.
      for (const [depth,opacity] of [[13.5,.18],[11,.35],[8.5,.60],[5.5,1]]) {
        ctx.globalAlpha = alpha*opacity; this.ribbon(ctx,edge,depth,302,edge.paint);
      }
      ctx.globalAlpha = alpha;
    } else {
      this.ribbon(ctx, edge, 7, 301, '#6b75482b');
      this.ribbon(ctx, edge, 5.5, 302, edge.paint);
    }
    this.details(ctx, edge, false);
    ctx.restore();
  }
  shore(ctx: CanvasRenderingContext2D, edge: NaturalEdge): void {
    // Caller supplies the land-facing edge of a water tile; the band extends toward the water.
    const waterward = { ...edge, direction: [-edge.direction[0], -edge.direction[1]] as const };
    const a = this.axes(edge);
    waterward.x = a.x - (waterward.direction[0] > 0 ? TILE_SIZE : 0);
    waterward.y = a.y - (waterward.direction[1] > 0 ? TILE_SIZE : 0);
    ctx.save();
    this.ribbon(ctx, waterward, 9.5, 303, edge.cold ? '#b6d0c5' : '#b7ab78');
    this.ribbon(ctx, waterward, 7.3, 303, edge.cold ? '#cbded3' : '#cdbb8d');
    this.ribbon(ctx, waterward, 3.7, 304, edge.paint);
    this.details(ctx, waterward, true);
    ctx.restore();
  }
  cliff(ctx: CanvasRenderingContext2D, edge: NaturalEdge): void {
    ctx.save(); this.ribbon(ctx, edge, 3, 306, edge.paint); this.details(ctx, edge, false, true); ctx.restore();
  }
  private details(ctx: CanvasRenderingContext2D, edge: NaturalEdge, shore: boolean, cliff = false): void {
    const a = this.axes(edge), salt = a.dx ? 321 : 342;
    const start = Math.max(6, edge.trimStart ?? 0), end = Math.min(TILE_SIZE - 5, TILE_SIZE - (edge.trimEnd ?? 0));
    for (let i = 0; i < 3; i++) {
      const v = noise(edge.tx, edge.ty, salt + i);
      if (v < (cliff ? .93 : shore ? .88 : .90)) continue;
      const along = start + (end - start) * (i + .25 + v * .5) / 3;
      const px = a.x + a.dx * along, py = a.y + a.dy * along;
      if (!edge.cold) {
        const plant = this.plant(Math.floor(v * 12), edge.moisture ?? .4, shore && v > .72);
        const size = .6 + noise(edge.tx, edge.ty, salt + i + 18) * .2;
        ctx.drawImage(plant, px - a.nx * 1.5 - 14 * size, py - a.ny * 1.5 - 20 * size, 28 * size, 24 * size);
      }
      if (!cliff && v > .49) {
        const bx = px + a.nx * (shore ? 6 : 9), by = py + a.ny * (shore ? 6 : 9);
        ctx.fillStyle = '#4b5c4545'; ctx.beginPath(); ctx.ellipse(bx, by + .8, 2.5, 1.5, v, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = shore ? '#c3c4a0' : '#c7bf96'; ctx.beginPath(); ctx.ellipse(bx - .2, by, 2.1, 1.2, v, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e2ddbc85'; ctx.fillRect(bx - 1, by - .7, 1.4, .7);
      }
    }
  }
  private plant(variant: number, moisture: number, reed: boolean): HTMLCanvasElement {
    const wet = moisture > .55, key = `${variant}:${wet}:${reed}`;
    const cached = this.plants.get(key); if (cached) return cached;
    const canvas = document.createElement('canvas'); canvas.width = 56; canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.fillStyle = '#263d2630'; ctx.beginPath(); ctx.ellipse(14, 20, 6.5, 2, 0, 0, Math.PI * 2); ctx.fill();
    const palette = wet ? ['#4b6d42', '#769553', '#a5b975'] : ['#5c7844', '#899f59', '#bac57b'];
    const count = reed ? 5 : 7;
    for (let i = 0; i < count; i++) {
      const v = noise(variant, i, 367), spread = (i - (count - 1) / 2) * 2.5;
      const length = (reed ? 10 : 5) + v * (reed ? 8 : 7), tipX = 14 + spread * 1.7, tipY = 20 - length;
      ctx.beginPath(); ctx.moveTo(14 + spread * .25, 20);
      ctx.quadraticCurveTo(14 + spread * .5 - 1.5, 20 - length * .7, tipX, tipY);
      ctx.quadraticCurveTo(14 + spread * .9 + 2, 20 - length * .45, 15 + spread * .25, 20);
      ctx.fillStyle = palette[i % 3]; ctx.fill();
      if (reed && i % 2 === 0) {
        ctx.strokeStyle = '#715d3f'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(tipX, tipY - 2); ctx.lineTo(tipX, tipY + 2); ctx.stroke();
      }
    }
    if (!reed && variant % 4 === 1) {
      ctx.fillStyle = '#dbd6a1';
      for (const [x, y] of [[8, 14], [18, 12]]) { ctx.beginPath(); ctx.arc(x, y, 1.3, 0, Math.PI * 2); ctx.fill(); }
    }
    this.plants.set(key, canvas); return canvas;
  }
}
