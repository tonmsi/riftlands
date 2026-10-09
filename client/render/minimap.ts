import { DungeonInstanceWorld } from '../../shared/dungeon-instance';
import { dungeonRoomAt, dungeonShadowVisible } from '../../shared/dungeon-topology';
import { TILE_SIZE } from '../../shared/config';
import type { Actor, Pickup } from '../../shared/types';
import type { World } from '../../shared/world';
import { DUNGEON_DEFINITIONS, dungeonAtTile } from '../../shared/dungeons';
import { shapeBounds } from '../../shared/world-authoring';
import { mapTerrainColor } from './terrain-style';
import { renderDpr } from '../core/frame-budget';
import { PICKUP_COLORS, circle, noise } from './render-primitives';
import { activeQuestAreas } from '../../shared/quest-areas';
import type { NarrativeProgress } from '../../shared/narrative';

/** Mappa locale limitata del terreno procedurale noto. */
const minimapTerrainViews = new WeakMap<HTMLCanvasElement, { world: World; key: string; canvas: HTMLCanvasElement; width: number; height: number }>();
export function drawMinimap(canvas: HTMLCanvasElement, world: World, self: Actor | null, actors: Actor[], pickups: Pickup[] = [], visibleSpan = 1600, viewSign = 1, narrative?: NarrativeProgress): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect(), dpr = renderDpr(window.devicePixelRatio, rect.width, rect.height);
  const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(0, height / 2);
  ctx.scale(1, viewSign);
  ctx.translate(0, -height / 2);
  const scale = Math.min(width, height) / visibleSpan;
  canvas.dataset.worldSpan = String(visibleSpan);
  canvas.dataset.viewSign = String(viewSign);
  const spawn = world.authoring.document.spawn;
  const center = self ?? { x: spawn.x * TILE_SIZE, y: spawn.y * TILE_SIZE };
  const left = center.x - width / (2 * scale), top = center.y - height / (2 * scale);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#525f46';
  ctx.fillRect(0, 0, width, height);

  const startX = Math.floor(left / TILE_SIZE), startY = Math.floor(top / TILE_SIZE);
  const cols = Math.ceil(width / scale / TILE_SIZE) + 2, rows = Math.ceil(height / scale / TILE_SIZE) + 2;
  const terrainKey = `${world.lockRevision}:${world.authoringRevision}:${startX}:${startY}:${width}:${height}:${visibleSpan}:${dpr}`;
  let cached = minimapTerrainViews.get(canvas);
  if (!cached || cached.world !== world || cached.key !== terrainKey) {
    const bitmap = document.createElement('canvas'), bitmapWidth = cols * TILE_SIZE * scale, bitmapHeight = rows * TILE_SIZE * scale;
    bitmap.width = Math.ceil(bitmapWidth * dpr); bitmap.height = Math.ceil(bitmapHeight * dpr);
    const paint = bitmap.getContext('2d')!; paint.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let ty = startY; ty < startY + rows; ty++) {
      for (let tx = startX; tx < startX + cols; tx++) {
      const tile = world.getTile(tx, ty);
      const dungeon = world.mode === 'world' ? dungeonAtTile(tx, ty) : undefined;
      paint.fillStyle = dungeon && tile === 'rock' ? dungeon.theme.wallTop
        : dungeon && tile === dungeon.layout.floor ? dungeon.theme.floor
        : mapTerrainColor(tile, world.getMoisture((tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE), noise(tx, ty));
      paint.fillRect((tx - startX) * TILE_SIZE * scale, (ty - startY) * TILE_SIZE * scale, TILE_SIZE * scale + 0.5, TILE_SIZE * scale + 0.5);
      }
    }
    cached = { world, key: terrainKey, canvas: bitmap, width: bitmap.width / dpr, height: bitmap.height / dpr }; minimapTerrainViews.set(canvas, cached);
  }
  ctx.drawImage(cached.canvas, (startX * TILE_SIZE - left) * scale, (startY * TILE_SIZE - top) * scale, cached.width, cached.height);

  ctx.strokeStyle = 'rgba(235,227,192,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height);
  ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2);
  ctx.stroke();

  for (const pickup of pickups) {
    ctx.fillStyle = PICKUP_COLORS[pickup.kind];
    ctx.fillRect((pickup.x - left) * scale - 1, (pickup.y - top) * scale - 1, 2, 2);
  }

  if (world.mode === 'world') {
    for (const dungeon of world.dungeons) {
      const dx = Math.max(10, Math.min(width - 10, (dungeon.area.x - left) * scale));
      const dy = Math.max(10, Math.min(height - 10, (dungeon.area.y - top) * scale));
      ctx.save();
      ctx.translate(dx, dy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = dungeon.theme.minimap;
      ctx.strokeStyle = '#423f32';
      ctx.lineWidth = 1.5;
      ctx.fillRect(-5, -5, 10, 10);
      ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();
    }
    for (const zone of world.authoring.document.zones) {
      if (!zone.arenaId) continue;
      const b = shapeBounds(zone.shape); ctx.beginPath();
      if (zone.shape.kind === 'circle') circle(ctx, (zone.shape.x * TILE_SIZE - left) * scale, (zone.shape.y * TILE_SIZE - top) * scale, zone.shape.radius * TILE_SIZE * scale);
      else ctx.rect((b.left * TILE_SIZE - left) * scale, (b.top * TILE_SIZE - top) * scale, (b.right-b.left)*TILE_SIZE*scale, (b.bottom-b.top)*TILE_SIZE*scale);
      ctx.strokeStyle=zone.arenaId?'#a5d9e8':zone.pvp?'#dc7a65':'#b6d9b0';ctx.lineWidth=1;ctx.stroke();
    }
  }

  const questAreas = world.mode === 'world' ? activeQuestAreas(world.authoring.document.zones, narrative) : [];
  canvas.dataset.questTargetCount = String(questAreas.length);
  for (const zone of questAreas) {
    const b = shapeBounds(zone.shape), tx = ((b.left + b.right) / 2 * TILE_SIZE - left) * scale;
    const ty = ((b.top + b.bottom) / 2 * TILE_SIZE - top) * scale;
    const dx = tx - width / 2, dy = ty - height / 2;
    const onMap = tx >= 12 && tx <= width - 12 && ty >= 12 && ty <= height - 12;
    const edge = Math.min(1, (width / 2 - 12) / Math.max(.001, Math.abs(dx)), (height / 2 - 12) / Math.max(.001, Math.abs(dy)));
    ctx.save(); ctx.fillStyle = '#ffe087'; ctx.strokeStyle = '#302919'; ctx.lineWidth = 1.5;
    if (onMap) {
      ctx.globalAlpha = .2; ctx.beginPath();
      if (zone.shape.kind === 'circle') circle(ctx, tx, ty, zone.shape.radius * TILE_SIZE * scale);
      else ctx.rect((b.left * TILE_SIZE - left) * scale, (b.top * TILE_SIZE - top) * scale,
        (b.right - b.left) * TILE_SIZE * scale, (b.bottom - b.top) * TILE_SIZE * scale);
      ctx.fill(); ctx.globalAlpha = 1; ctx.translate(tx, ty); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-5, -5, 10, 10); ctx.strokeRect(-5, -5, 10, 10);
    } else {
      ctx.translate(width / 2 + dx * edge, height / 2 + dy * edge); ctx.rotate(Math.atan2(dy, dx));
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  for (const actor of actors) {
    if (actor.id === self?.id || actor.hp <= 0) continue;
    ctx.fillStyle = actor.kind === 'npc' ? '#ccbb8d' : actor.teamId && actor.teamId === self?.teamId ? '#a6dcb4' : '#e6a08c';
    circle(ctx, (actor.x - left) * scale, (actor.y - top) * scale, actor.kind === 'npc' ? 1.6 : 2.5);
    ctx.fill();
  }

  const originX = (spawn.x * TILE_SIZE - left) * scale, originY = (spawn.y * TILE_SIZE - top) * scale;
  ctx.strokeStyle = 'rgba(242,229,181,0.7)';
  ctx.lineWidth = 1;
  circle(ctx, originX, originY, 4);
  ctx.stroke();

  if (self && world instanceof DungeonInstanceWorld) {
    const d = world.dungeon, t = d.topology!, origin = { x: d.layout.bounds.minTx, y: d.layout.bounds.minTy }, room = dungeonRoomAt(t, origin, self);
    ctx.fillStyle = '#080711';
    for (let ty = startY; ty < startY+rows; ty++) for (let tx = startX; tx < startX+cols; tx++) {
      const point = { x: (tx+.5)*TILE_SIZE, y: (ty+.5)*TILE_SIZE };
      if (dungeonRoomAt(t,origin,point)?.id !== room?.id || !dungeonShadowVisible(t,origin,self,point)) ctx.fillRect((tx*TILE_SIZE-left)*scale,(ty*TILE_SIZE-top)*scale,TILE_SIZE*scale+.5,TILE_SIZE*scale+.5);
    }
  }
  if (self) {
    ctx.save();
    ctx.translate(width / 2, height / 2);
    circle(ctx, 0, 0, 4);
    ctx.fillStyle = '#fbefd2';
    ctx.fill();
    ctx.strokeStyle = '#384537';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}
