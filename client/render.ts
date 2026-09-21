import { CHUNK_SIZE, CLASSES, PLAYER_RADIUS, TILE_SIZE, WORLD_SEED } from '../shared/config';
import type { AbilitySlot, Actor, ClassId, GameEvent, Pickup, Projectile, TileKind, Trap, Vec2, RoomMode } from '../shared/types';
import { World } from '../shared/world';
import { ARENA_GATE } from '../shared/arena';
import { OUTPOST } from '../shared/outpost';
import type { ArenaGateState } from '../shared/types';
import { DUNGEON_BY_BOSS_ID, DUNGEON_DEFINITIONS, dungeonApproachNormal, dungeonApproachPoint, dungeonAtTile, dungeonFlames, inwardFlameAngle } from '../shared/dungeons';
import type { DungeonDefinition } from '../shared/dungeons';
import type { BossDrop, BossLockState, BossWindup } from '../shared/bosses';
import { playerSpriteDirectionRow, spriteDirectionRow } from './sprite-direction';
import { EnvironmentArt } from './environment-art';
import { renderDpr } from './frame-budget';
import { TERRAIN, groundColor, shorelineMask, sceneryGroups, mapTerrainColor } from './terrain-style';

const CLASS_SPRITE_URLS: Partial<Record<ClassId, string>> = {
  paladin: new URL('../assets/paladino256.svg', import.meta.url).href,
  mage: new URL('../assets/mage256.svg', import.meta.url).href,
  warrior: new URL('../assets/warrior256.svg', import.meta.url).href
};
const NPC_SPRITE_URLS: Partial<Record<NonNullable<Actor['npcKind']>, string>> = {
  wisp: new URL('../assets/wisp.svg', import.meta.url).href,
  slime: new URL('../assets/slime.svg', import.meta.url).href,
  sentinel: new URL('../assets/sentinel.svg', import.meta.url).href
};
const BOSS_SPRITE_URLS: Record<string, string> = {
  'stone-warden': new URL('../assets/boss_warden.svg', import.meta.url).href,
};
const FRAME_SIZE = 256;
const DRAW_SIZE_SIZE = 48;
const NPC_FRAME_SIZE = 256;
const NPC_DRAW_SIZE = 48;
const BOSS_DRAW_SIZE = 84;
const SPRITE_COLUMNS = 4;
const SPRITE_ROWS = 4;
const SPRITE_RASTER_DPR = 2;
const MAX_LOGICAL_VIEWPORT = { width: 2200, height: 1400 };

interface RasterSpriteSheet {
  frames: HTMLCanvasElement[];
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error(`Impossibile caricare la sprite ${url}`)), { once: true });
  });
  image.src = url;
  await loaded;
  try { await image.decode(); } catch { /* onload already verified that the image is usable */ }
  return image;
}

/** Rasterizes vector artwork once; the animation loop only ever sees small bitmap frames. */
async function rasterizeSpriteSheet(url: string, frameSize: number, drawSize: number): Promise<RasterSpriteSheet> {
  const image = await loadImage(url);
  const atlas = document.createElement('canvas');
  atlas.width = image.naturalWidth;
  atlas.height = image.naturalHeight;
  const atlasContext = atlas.getContext('2d');
  if (!atlasContext) throw new Error('Canvas 2D non disponibile per la cache delle sprite.');
  atlasContext.imageSmoothingEnabled = true;
  atlasContext.imageSmoothingQuality = 'high';
  atlasContext.drawImage(image, 0, 0);

  // Keep small sprite sources sharp when scaled, independently of the canvas budget.
  const cachedSize = Math.ceil(drawSize * SPRITE_RASTER_DPR);
  const frames: HTMLCanvasElement[] = [];
  for (let row = 0; row < SPRITE_ROWS; row++) {
    for (let column = 0; column < SPRITE_COLUMNS; column++) {
      const frame = document.createElement('canvas');
      frame.width = cachedSize;
      frame.height = cachedSize;
      const frameContext = frame.getContext('2d');
      if (!frameContext) throw new Error('Canvas 2D non disponibile per un frame della sprite.');
      frameContext.imageSmoothingEnabled = true;
      frameContext.imageSmoothingQuality = 'high';
      frameContext.drawImage(atlas, column * frameSize, row * frameSize, frameSize, frameSize, 0, 0, cachedSize, cachedSize);
      frames.push(frame);
    }
  }
  return { frames };
}

export interface RenderFrame {
  goldDrops?: BossDrop[];
  bossWindups?: BossWindup[];
  bossLocks?: BossLockState[];
  arenaGate?: ArenaGateState;
  time: number;
  self: Actor | null;
  actors: Actor[];
  projectiles: Projectile[];
  pickups: Pickup[];
  traps: Trap[];
  events: GameEvent[];
  selectedId: string | null;
  previewClass: ClassId;
  playing: boolean;
  /** Direction requested by the local player; null means standing still. */
  moveDirection?: Vec2 | null;
  aimPreview?: { slot: AbilitySlot; angle: number } | null;
}
const TAU = Math.PI * 2;
const PICKUP_COLORS: Record<Pickup['kind'], string> = {
  heal: '#b6e5aa', haste: '#a5dbe2', power: '#e5cc81', weakness: '#bb99cb',
};

function noise(x: number, y: number, offset = 0): number {
  let n = Math.imul(x ^ (offset * 713), 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, TAU);
}

function polygon(ctx: CanvasRenderingContext2D, points: number[]): void {
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 2) {
    if (!i) ctx.moveTo(points[i], points[i + 1]);
    else ctx.lineTo(points[i], points[i + 1]);
  }
  ctx.closePath();
}

function coverTileBleed(ctx: CanvasRenderingContext2D, vx: number, vy: number, corner: number, radius: number, color: string, scale: number): void {
  ctx.fillStyle = color;
  const e = Math.max(1, 1.5 / scale);
  const cx = vx * TILE_SIZE, cy = vy * TILE_SIZE;
  const signX = (corner === 0 || corner === 3) ? 1 : -1;
  const signY = (corner === 0 || corner === 1) ? 1 : -1;

  // Cover pixel-aligned base tile bleed outside the tile, preserving the curve.
  const rx1 = signX === 1 ? cx - e : cx;
  const ry1 = signY === 1 ? cy - e : cy - radius;
  ctx.fillRect(rx1, ry1, e, radius + e);

  const rx2 = signX === 1 ? cx - e : cx - radius;
  const ry2 = signY === 1 ? cy - e : cy;
  ctx.fillRect(rx2, ry2, radius + e, e);
}

/** All artwork is deliberately procedural geometry. Assets can replace these passes independently. */
export class Renderer {
  world = new World(WORLD_SEED);
  readonly camera: Vec2 = { x: 0, y: 0 };
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly touchQuery = matchMedia('(pointer: coarse)');
  private width = 1;
  private height = 1;
  private dpr = 1;
  private zoom = 1;
  private lastTime = 0;
  private wasPlaying = false;
  private hasCamera = false;
  private bounds = { left: 0, top: 0, right: 0, bottom: 0 };
  private readonly classSprites = new Map<ClassId, RasterSpriteSheet>();
  private readonly npcSprites = new Map<string, RasterSpriteSheet>();
  private readonly classMotion = new Map<string, { x: number; y: number; row: number; startedAt: number; moving: boolean }>();
  private readonly environmentArt = new EnvironmentArt();
  private terrainCache?: { canvas: HTMLCanvasElement; world: World; scale: number;
    left: number; top: number; right: number; bottom: number };
  readonly spritesReady: Promise<void>;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D non disponibile in questo browser.');
    this.ctx = ctx;
    this.spritesReady = this.prepareSprites();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setSeed(seed: number, mode: RoomMode = 'world'): void {
    this.world = new World(seed, 160, mode);
    this.terrainCache = undefined;
    this.hasCamera = false;
    this.classMotion.clear();
    this.resize();
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.width / 2) / this.zoom + this.camera.x,
      y: (clientY - rect.top - this.height / 2) / this.zoom + this.camera.y,
    };
  }

  destroy(): void { this.resizeObserver.disconnect(); this.terrainCache = undefined; }

  private async prepareSprites(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const [classId, url] of Object.entries(CLASS_SPRITE_URLS) as [ClassId, string][]) {
      jobs.push(rasterizeSpriteSheet(url, FRAME_SIZE, DRAW_SIZE_SIZE)
        .then(sprite => { this.classSprites.set(classId, sprite); })
        .catch(error => { console.warn(error); }));
    }
    for (const [npcKind, url] of Object.entries(NPC_SPRITE_URLS) as [NonNullable<Actor['npcKind']>, string][]) {
      jobs.push(rasterizeSpriteSheet(url, NPC_FRAME_SIZE, NPC_DRAW_SIZE)
        .then(sprite => { this.npcSprites.set(npcKind, sprite); })
        .catch(error => { console.warn(error); }));
    }
    for (const [skin, url] of Object.entries(BOSS_SPRITE_URLS)) {
      jobs.push(rasterizeSpriteSheet(url, NPC_FRAME_SIZE, BOSS_DRAW_SIZE)
        .then(sprite => { this.npcSprites.set(`boss:${skin}`, sprite); })
        .catch(error => { console.warn(error); }));
    }
    await Promise.all(jobs);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = renderDpr(window.devicePixelRatio, this.width, this.height);
    this.terrainCache = undefined;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    const baseZoom = (this.width < 680 ? 0.8 : 0.95) * (this.touchQuery.matches ? 0.8 : 1);
    // A browser zoom-out enlarges the CSS viewport without enlarging the actual
    // screen. Keep the logical world viewport bounded so it cannot generate a
    // huge amount of procedural terrain in one frame.
    const viewportScale = Math.max(1, this.width / MAX_LOGICAL_VIEWPORT.width, this.height / MAX_LOGICAL_VIEWPORT.height);
    this.zoom = baseZoom * viewportScale;
    if (this.world.mode === 'arena') this.zoom = this.touchQuery.matches
      ? Math.max(0.8, Math.min(this.width / 960, this.height / 768)) * 0.8
      : Math.max(0.3, Math.min((this.width - 40) / 960, (this.height - 230) / 768));
  }

  render(frame: RenderFrame): void {
    const ctx = this.ctx;
    const now = performance.now();
    const delta = this.lastTime ? Math.max(0, Math.min(80, now - this.lastTime)) : 16;
    this.lastTime = now;
    if (this.dpr !== renderDpr(window.devicePixelRatio, this.width, this.height)) this.resize();
    const target = this.world.mode === 'arena' && frame.playing && !this.touchQuery.matches ? { x: 0, y: 0 } : frame.self && frame.playing ? frame.self : {
      x: 25 + Math.sin(frame.time * 0.000025) * 18,
      y: 12 + Math.cos(frame.time * 0.000019) * 12,
    };
    if (!this.hasCamera || (frame.playing && !this.wasPlaying)) {
      this.camera.x = target.x;
      this.camera.y = target.y;
      this.hasCamera = true;
    } else {
      const smoothing = 1 - Math.exp(-delta / 95);
      this.camera.x += (target.x - this.camera.x) * smoothing;
      this.camera.y += (target.y - this.camera.y) * smoothing;
    }
    this.wasPlaying = frame.playing;
    this.bounds = {
      left: this.camera.x - this.width / (2 * this.zoom) - 100,
      right: this.camera.x + this.width / (2 * this.zoom) + 100,
      top: this.camera.y - this.height / (2 * this.zoom) - 100,
      bottom: this.camera.y + this.height / (2 * this.zoom) + 100,
    };
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = TERRAIN.grass;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);
    this.drawCachedTerrain(frame.time);
    if (this.world.mode === 'world') {
      this.drawCrossroads(frame.time); //posso togliere frame time se è statico e non voglio animazioni
      this.drawArenaGate(frame.time, frame.arenaGate);
      this.drawDungeons();
    }
    for (const w of frame.bossWindups ?? []) {
      const progress = Math.max(0, Math.min(1, (frame.time - w.startedAt) / Math.max(1, w.resolvesAt - w.startedAt)));
      ctx.save(); ctx.fillStyle = 'rgba(216,72,45,0.2)'; ctx.strokeStyle = '#ffb184'; ctx.lineWidth = 3;
      if (w.kind === 'charge' && w.targetX !== undefined && w.targetY !== undefined) {
        const angle = Math.atan2(w.targetY - w.y, w.targetX - w.x), length = Math.hypot(w.targetX - w.x, w.targetY - w.y);
        ctx.translate(w.x, w.y); ctx.rotate(angle);
        ctx.fillRect(0, -w.radius, length, w.radius * 2);
        ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.moveTo(0, -w.radius); ctx.lineTo(length, -w.radius); ctx.moveTo(0, w.radius); ctx.lineTo(length, w.radius); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = `rgba(255,177,132,${0.25 + progress * 0.5})`; ctx.fillRect(length * progress - 4, -w.radius, 8, w.radius * 2);
      } else if (w.kind === 'nova') {
        ctx.beginPath(); ctx.arc(w.x, w.y, w.radius, 0, TAU); ctx.arc(w.x, w.y, w.innerRadius ?? 0, 0, TAU, true); ctx.fill('evenodd'); ctx.stroke();
        circle(ctx, w.x, w.y, (w.innerRadius ?? 0) + (w.radius - (w.innerRadius ?? 0)) * progress); ctx.stroke();
      } else {
        circle(ctx, w.x, w.y, w.radius); ctx.fill(); ctx.stroke();
        circle(ctx, w.x, w.y, w.radius * progress); ctx.stroke();
      }
      ctx.restore();
    }
    for (const gold of frame.goldDrops ?? []) if (this.visible(gold)) {
      ctx.save(); ctx.translate(gold.x, gold.y); ctx.fillStyle = 'rgba(241,197,85,0.15)'; circle(ctx, 0, 0, 23); ctx.fill();
      ctx.fillStyle = '#edc463'; ctx.strokeStyle = '#7d572c'; ctx.lineWidth = 2;
      for (const [x, y] of [[-7, 4], [6, 3], [0, -5]]) { circle(ctx, x, y, 7); ctx.fill(); ctx.stroke(); }
      ctx.font = '600 11px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff0c5'; ctx.fillText(`${gold.amount} gold`, 0, -23); ctx.restore();
    }
    const events = frame.events.filter(event => frame.time >= event.at && frame.time - event.at < event.duration);
    if (frame.self && frame.self.hp > 0 && frame.aimPreview != null) {
      const ability = CLASSES[frame.self.classId].abilities[frame.aimPreview.slot];
      ctx.save(); ctx.translate(frame.self.x, frame.self.y); ctx.rotate(frame.aimPreview.angle);
      ctx.strokeStyle = '#fff1c470'; ctx.fillStyle = '#fff1c40c'; ctx.lineWidth = 1 / this.zoom;
      if (ability.kind === 'melee') {
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, ability.range, -0.65, 0.65); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (ability.kind === 'trap') {
        circle(ctx, Math.min(ability.range || 60, 60), 0, ability.radius); ctx.stroke();
      } else {
        ctx.setLineDash([5, 9]);
        ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(ability.range, 0); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(ability.range - 7, -4); ctx.lineTo(ability.range, 0); ctx.lineTo(ability.range - 7, 4); ctx.stroke();
      }
      ctx.restore();
    }
    for (const event of events) this.drawGroundEvent(event, frame.time);
    const pickups = frame.playing ? frame.pickups : [
      ...this.world.getChunk(0, 0).pickups, ...this.world.getChunk(-1, 0).pickups,
    ];
    for (const pickup of pickups) if (this.visible(pickup)) this.drawPickup(pickup, frame.time);
    if (frame.traps) {
      for (const trap of frame.traps) if (this.visible(trap)) this.drawTrap(trap, frame.time);
    }
    // Cull before sorting; distant teammates still reach the edge indicators.
    const actors = frame.playing ? frame.actors.filter(actor => this.visible(actor)) : this.previewActors(frame.previewClass, frame.time);
    if (frame.self && frame.playing) {
      const index = actors.findIndex(actor => actor.id === frame.self!.id);
      if (index >= 0) actors[index] = frame.self;
      else actors.push(frame.self);
    }
    const liveMotion = new Set(actors.map(actor => actor.id));
    for (const id of this.classMotion.keys()) if (!liveMotion.has(id)) this.classMotion.delete(id);
    const hitTargets = new Set<string>();
    for (const event of events) if (event.kind === 'hit' && event.targetId && frame.time - event.at < 130) hitTargets.add(event.targetId);
    actors.sort((a, b) => a.y - b.y);
    for (const actor of actors) {
      if (!this.visible(actor)) continue;
      const self = actor.id === frame.self?.id || (!frame.playing && actor.id === 'preview');
      const allied = !!frame.self?.teamId && actor.teamId === frame.self.teamId;
      this.drawActor(actor, frame.time, self, allied, actor.id === frame.selectedId, hitTargets,
        self ? frame.moveDirection : undefined, actors.length <= 200 || self || allied || actor.id === frame.selectedId || actor.npcKind === 'boss');
    }
    for (const projectile of frame.projectiles) if (this.visible(projectile)) this.drawProjectile(projectile, frame.time);
    if (this.world.mode === 'world') this.drawDungeonFlames(frame.time, frame.bossLocks);

    for (const event of events) this.drawFloatingEvent(event, frame.time);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawTeamIndicators(frame);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // <-- AGGIUNGI QUESTA RIGA:
    this.drawRain(frame.time);
    const vignette = ctx.createRadialGradient(this.width / 2, this.height / 2, this.width * 0.2, this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.68);
    vignette.addColorStop(0, 'rgba(19,29,24,0)');
    vignette.addColorStop(1, 'rgba(19,29,24,0.18)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawTrap(trap: Trap, time: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(trap.x, trap.y);
    
    // Area di innesco visibile delicata
    ctx.strokeStyle = `${trap.color}44`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    circle(ctx, 0, 0, trap.radius);
    ctx.stroke();
    ctx.setLineDash([]);

    // Denti / ganasce della trappola meccanica
    ctx.fillStyle = '#2f382a';
    circle(ctx, 0, 0, 16);
    ctx.fill();
    ctx.strokeStyle = trap.color;
    ctx.lineWidth = 2;
    circle(ctx, 0, 0, 16);
    ctx.stroke();

    // Denti metallici
    ctx.fillStyle = '#b7cfad';
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const tx = Math.cos(angle) * 14;
      const ty = Math.sin(angle) * 14;
      polygon(ctx, [tx, ty, tx * 0.5 - ty * 0.2, ty * 0.5 + tx * 0.2, tx * 0.5 + ty * 0.2, ty * 0.5 - tx * 0.2]);
      ctx.fill();
    }

    // Piatto di pressione centrale
    circle(ctx, 0, 0, 5 + Math.sin(time * 0.005) * 1);
    ctx.fillStyle = '#9bd48c';
    ctx.fill();

    ctx.restore();
  }

  private visible(point: Vec2): boolean {
    return point.x >= this.bounds.left && point.x <= this.bounds.right && point.y >= this.bounds.top && point.y <= this.bounds.bottom;
  }

  private drawTeamIndicators(frame: RenderFrame): void {
    if (!frame.playing || !frame.self?.teamId) return;
    const ctx = this.ctx;
    const centerX = this.width / 2, centerY = this.height / 2;
    const edge = 22;
    for (const teammate of frame.actors) {
      if (teammate.id === frame.self.id || teammate.teamId !== frame.self.teamId || this.visible(teammate)) continue;
      const dx = (teammate.x - this.camera.x) * this.zoom;
      const dy = (teammate.y - this.camera.y) * this.zoom;
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) continue;
      const scale = Math.min((this.width / 2 - edge) / Math.abs(dx || 1), (this.height / 2 - edge) / Math.abs(dy || 1));
      const x = centerX + dx * Math.min(1, scale);
      const y = centerY + dy * Math.min(1, scale);
      const angle = Math.atan2(dy, dx);
      const color = CLASSES[teammate.classId].color;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = `${color}e8`;
      ctx.strokeStyle = '#16251b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-3, 0); ctx.lineTo(-6, 7); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.rotate(-angle);
      ctx.font = '600 10px Inter, system-ui, sans-serif';
      ctx.textAlign = x < centerX ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#edf3d8';
      ctx.shadowColor = '#132319'; ctx.shadowBlur = 4;
      ctx.fillText(teammate.name, x < centerX ? 14 : -14, 0);
      ctx.restore();
    }
  }

  private drawCachedTerrain(time: number): void {
    const scale = this.dpr * this.zoom;
    const left = this.camera.x - this.width / (2 * this.zoom);
    const top = this.camera.y - this.height / (2 * this.zoom);
    const right = left + this.width / this.zoom, bottom = top + this.height / this.zoom;
    let cache = this.terrainCache;
    if (!cache || cache.world !== this.world || cache.scale !== scale ||
      left < cache.left || top < cache.top || right > cache.right || bottom > cache.bottom) {
      // One bounded bitmap, with room for camera movement. No growing world atlas.
      const margin = 192;
      const x = Math.floor((left - margin) * scale) / scale;
      const y = Math.floor((top - margin) * scale) / scale;
      const canvas = cache?.canvas ?? document.createElement('canvas');
      canvas.width = Math.ceil((right + margin - x) * scale);
      canvas.height = Math.ceil((bottom + margin - y) * scale);
      const ctx = canvas.getContext('2d', { alpha: false })!;
      ctx.fillStyle = TERRAIN.grass; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
      cache = { canvas, world: this.world, scale, left: x, top: y,
        right: x + canvas.width / scale, bottom: y + canvas.height / scale };
      // Include off-bitmap neighbours so foliage and shore details are not clipped at their anchors.
      this.drawTerrain(time, ctx, { left: x - 100, top: y - 100,
        right: cache.right + 100, bottom: cache.bottom + 100 });
      this.terrainCache = cache;
    }
    this.ctx.drawImage(cache.canvas, cache.left, cache.top,
      cache.canvas.width / scale, cache.canvas.height / scale);
  }

  private drawTerrain(time: number, ctx = this.ctx, bounds = this.bounds): void {
    const waterPlants: { x: number; y: number; variation: number; shore: number }[] = [];
    const transform = ctx.getTransform();
    type SurfaceKind = 'grass' | 'path' | 'mud' | 'stone' | 'water';
    const scenery = (tile: TileKind) => tile === 'rock' || tile === 'bush';
    const rawSurfaceAt = (tx: number, ty: number): SurfaceKind | null => {
      if (this.world.mode === 'arena' && (tx < -10 || tx > 9 || ty < -8 || ty > 7)) return null;
      const tile = this.world.getTile(tx, ty);
      if (scenery(tile)) return null;
      const dungeon = this.world.mode === 'world' ? dungeonAtTile(tx, ty) : undefined;
      if (dungeon && tile === dungeon.layout.floor) return 'stone';
      return tile === 'path' || tile === 'mud' || tile === 'water' ? tile : 'grass';
    };
    const inferredScenerySurface = (tx: number, ty: number): SurfaceKind => {
      // Obstacles are a transparent visual layer. Existing dungeon files do not
      // store an underlay, so inherit the nearest visible material instead of
      // assigning rocks to dungeon floor and bushes to grass.
      for (let radius = 1; radius <= 4; radius++) {
        const scores = new Map<SurfaceKind, number>();
        const offsets: [number, number][] = radius === 1
          ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [1, 1], [-1, 1]]
          : [];
        if (radius > 1) for (let offset = -radius; offset <= radius; offset++) {
          offsets.push([-radius, offset], [radius, offset]);
          if (Math.abs(offset) !== radius) offsets.push([offset, -radius], [offset, radius]);
        }
        for (const [dx, dy] of offsets) {
          const candidate = rawSurfaceAt(tx + dx, ty + dy);
          if (!candidate || candidate === 'water') continue;
          const weight = dx === 0 || dy === 0 ? 2 : 1;
          scores.set(candidate, (scores.get(candidate) ?? 0) + weight);
        }
        if (scores.size) {
          let best: SurfaceKind = scores.keys().next().value!;
          for (const [candidate, score] of scores)
            if (score > scores.get(best)!) best = candidate;
          return best;
        }
      }
      return dungeonAtTile(tx, ty) ? 'stone' : 'grass';
    };
    const surfaces = new Map<string, SurfaceKind | null>();
    const surfaceAt = (tx: number, ty: number): SurfaceKind | null => {
      const key = `${tx},${ty}`;
      if (surfaces.has(key)) return surfaces.get(key)!;
      const raw = rawSurfaceAt(tx, ty);
      const surface = raw ?? (scenery(this.world.getTile(tx, ty)) ? inferredScenerySurface(tx, ty) : null);
      surfaces.set(key, surface);
      return surface;
    };
    const surfaceColor = (surface: Exclude<SurfaceKind, 'water'>, tx: number, ty: number) => {
      if (surface === 'grass')
        return groundColor(this.world.getMoisture((tx + .5) * TILE_SIZE, (ty + .5) * TILE_SIZE));
      if (surface === 'stone') return dungeonAtTile(tx, ty)?.theme.floor ?? TERRAIN.path;
      return TERRAIN[surface];
    };
    const cornerNeighbours = [
      [[0, -1], [-1, 0], [-1, -1]], [[0, -1], [1, 0], [1, -1]],
      [[0, 1], [1, 0], [1, 1]], [[0, 1], [-1, 0], [-1, 1]],
    ] as const;
    type ShoreBacking = { surface: Exclude<SurfaceKind, 'water'>; sourceX: number; sourceY: number };
    const shoreBackings = new Map<string, ShoreBacking>();
    const shoreBackingAt = (tx: number, ty: number): ShoreBacking => {
      const key = `${tx},${ty}`, cached = shoreBackings.get(key);
      if (cached) return cached;
      const candidates = new Map<Exclude<SurfaceKind, 'water'>, ShoreBacking & { score: number }>();
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const) {
        const surface = surfaceAt(tx + dx, ty + dy);
        if (!surface || surface === 'water') continue;
        const existing = candidates.get(surface);
        const score = (existing?.score ?? 0) + (dx === 0 || dy === 0 ? 2 : 1);
        candidates.set(surface, { surface, sourceX: existing?.sourceX ?? tx + dx,
          sourceY: existing?.sourceY ?? ty + dy, score });
      }
      let best: (ShoreBacking & { score: number }) | undefined;
      for (const candidate of candidates.values()) if (!best || candidate.score > best.score) best = candidate;
      const backing: ShoreBacking = best
        ? { surface: best.surface, sourceX: best.sourceX, sourceY: best.sourceY }
        : { surface: 'grass', sourceX: tx, sourceY: ty };
      shoreBackings.set(key, backing);
      return backing;
    };
    // Cache just the visible chunks; sampling terrain then avoids regenerating tile noise every frame.
    for (let cy = Math.floor(bounds.top / CHUNK_SIZE); cy <= Math.floor(bounds.bottom / CHUNK_SIZE); cy++) {
      for (let cx = Math.floor(bounds.left / CHUNK_SIZE); cx <= Math.floor(bounds.right / CHUNK_SIZE); cx++) {
        this.world.getChunk(cx, cy);
      }
    }
    for (let ty = Math.floor(bounds.top / TILE_SIZE); ty <= Math.floor(bounds.bottom / TILE_SIZE); ty++) {
      for (let tx = Math.floor(bounds.left / TILE_SIZE); tx <= Math.floor(bounds.right / TILE_SIZE); tx++) {
        if (this.world.mode === 'arena' && (tx < -10 || tx > 9 || ty < -8 || ty > 7)) {
          ctx.fillStyle = '#202b29';
          ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE + 0.4, TILE_SIZE + 0.4);
          continue;
        }
        const tile = this.world.getTile(tx, ty);
        const x = tx * TILE_SIZE, y = ty * TILE_SIZE;
        const dungeon = this.world.mode === 'world' ? dungeonAtTile(tx, ty) : undefined;
        const variation = noise(tx, ty);
        const surface = surfaceAt(tx, ty);
        const waterBacking = tile === 'water' ? shoreBackingAt(tx, ty) : undefined;
        ctx.fillStyle = waterBacking ? surfaceColor(waterBacking.surface, waterBacking.sourceX, waterBacking.sourceY)
          : surface && surface !== 'water' ? surfaceColor(surface, tx, ty)
          : dungeon ? dungeon.theme.floor : TERRAIN.grass;
        // Opaque, pixel-aligned coverage avoids hairline seams at fractional camera zoom.
        const left = Math.floor(x * transform.a + transform.e);
        const top = Math.floor(y * transform.d + transform.f);
        const right = Math.ceil((x + TILE_SIZE) * transform.a + transform.e);
        const bottom = Math.ceil((y + TILE_SIZE) * transform.d + transform.f);
        ctx.fillRect((left - transform.e) / transform.a, (top - transform.f) / transform.d,
          (right - left) / transform.a, (bottom - top) / transform.d);
        if (tile === 'water') {
          // The water atlas exposes its backing around curved banks. Blend that
          // backing at mixed grass/path ends before placing the transparent sprite.
          for (let corner = 0; corner < 4; corner++) {
            const [aOffset, bOffset, diagonalOffset] = cornerNeighbours[corner];
            const a = surfaceAt(tx + aOffset[0], ty + aOffset[1]);
            const b = surfaceAt(tx + bOffset[0], ty + bOffset[1]);
            const diagonal = surfaceAt(tx + diagonalOffset[0], ty + diagonalOffset[1]);
            if (!diagonal || diagonal === 'water' || diagonal === waterBacking!.surface
              || (a !== diagonal && b !== diagonal)) continue;
            const dungeonJunction = diagonal === 'stone' || waterBacking!.surface === 'stone';
            const walkwayJunction = (diagonal === 'path' && waterBacking!.surface === 'grass')
              || (diagonal === 'grass' && waterBacking!.surface === 'path');
            const radius = dungeonJunction ? 19 : walkwayJunction ? 17 : 13;
            const color = surfaceColor(diagonal, tx + diagonalOffset[0], ty + diagonalOffset[1]);
            this.environmentArt.roundTerrainCorner(ctx, x, y, corner, color, radius);

            coverTileBleed(ctx, tx + (corner === 1 || corner === 2 ? 1 : 0),
              ty + (corner === 2 || corner === 3 ? 1 : 0), corner, radius, color, transform.a);
          }
          const shore = this.drawWater(tx, ty, x, y, time, ctx);
          if (shore) waterPlants.push({ x, y, variation: noise(tx, ty, 17), shore });
        } else if (tile === 'rock' || tile === 'bush') {
          // All scenery, including dungeon obstacles, uses the shared 1x1/2x2 pass below.
        } else {
          this.environmentArt.draw(ctx, tile, x, y, variation);
        }
      }
    }
    // Paint only after opaque coverage, so neighbouring cells cannot erase brush edges.
    for (let ty = Math.floor(bounds.top / TILE_SIZE); ty <= Math.floor(bounds.bottom / TILE_SIZE); ty++) {
      for (let tx = Math.floor(bounds.left / TILE_SIZE); tx <= Math.floor(bounds.right / TILE_SIZE); tx++) {
        if (this.world.mode === 'arena' && (tx < -10 || tx > 9 || ty < -8 || ty > 7)) continue;
        const surface = surfaceAt(tx, ty);
        if (surface && surface !== 'water') this.environmentArt.paintGround(ctx,
          surface === 'stone' ? 'path' : surface, tx * TILE_SIZE, ty * TILE_SIZE, surface === 'stone');
      }
    }
    const seamAccents = new Map<string, { x: number; y: number; variation: number }>();
    const vertexQuadrants = [[-1, -1, 2], [0, -1, 3], [0, 0, 0], [-1, 0, 1]] as const;
    for (let vy = Math.floor(bounds.top / TILE_SIZE); vy <= Math.floor(bounds.bottom / TILE_SIZE) + 1; vy++) {
      for (let vx = Math.floor(bounds.left / TILE_SIZE); vx <= Math.floor(bounds.right / TILE_SIZE) + 1; vx++) {
        const quadrants = vertexQuadrants.map(([dx, dy, corner]) => ({
          tx: vx + dx, ty: vy + dy, corner, surface: surfaceAt(vx + dx, vy + dy),
        }));
        if (quadrants.some(quadrant => !quadrant.surface || quadrant.surface === 'water')) continue;
        const counts = new Map<SurfaceKind, number>();
        for (const quadrant of quadrants) counts.set(quadrant.surface!, (counts.get(quadrant.surface!) ?? 0) + 1);
        if (counts.size !== 2) continue;

        const unique = quadrants.find(quadrant => counts.get(quadrant.surface!) === 1);
        const majority = quadrants.find(quadrant => counts.get(quadrant.surface!) === 3);

        const cornersToRound: typeof quadrants = [];
        let overlaySurface: SurfaceKind;
        let overlayTx: number, overlayTy: number;

        if (unique && majority) {
          cornersToRound.push(unique);
          overlaySurface = majority.surface!;
          overlayTx = majority.tx;
          overlayTy = majority.ty;
        } else if (!unique && !majority && quadrants[0].surface === quadrants[2].surface
          && quadrants[1].surface === quadrants[3].surface) {
          // Caso scacchiera diagonale: eseguiamo l'arrotondamento per stabilire continuità
          const surfaceA = quadrants[0].surface!;
          const surfaceB = quadrants[1].surface!;
          const priority = (s: SurfaceKind) => s === 'stone' ? 4 : s === 'path' ? 3 : s === 'mud' ? 2 : 1;
          const aAbove = priority(surfaceA) > priority(surfaceB);
          overlaySurface = aAbove ? surfaceA : surfaceB;
          const underSurface = aAbove ? surfaceB : surfaceA;
          for (const q of quadrants) if (q.surface === underSurface) cornersToRound.push(q);
          const overlayQ = quadrants.find(q => q.surface === overlaySurface)!;
          overlayTx = overlayQ.tx;
          overlayTy = overlayQ.ty;
        } else {
          continue;
        }

        for (const q of cornersToRound) {
          const current = q.surface!, other = overlaySurface;
          if (current === 'water' || other === 'water') continue;

          const dungeonJunction = current === 'stone' || other === 'stone';
          const walkwayJunction = (current === 'path' && other === 'grass')
            || (current === 'grass' && other === 'path');
          const radius = dungeonJunction ? 19 : walkwayJunction ? 17 : 13;
          const color = surfaceColor(other, overlayTx, overlayTy);
          const ux = q.tx * TILE_SIZE, uy = q.ty * TILE_SIZE;

          this.environmentArt.roundTerrainCorner(ctx, ux, uy, q.corner, color, radius);

          coverTileBleed(ctx, vx, vy, q.corner, radius, color, transform.a);

          if (dungeonJunction) {
            const cornerX = vx * TILE_SIZE, cornerY = vy * TILE_SIZE, key = `${cornerX},${cornerY}`;
            seamAccents.set(key, {
              x: cornerX, y: cornerY, variation: noise(cornerX / TILE_SIZE, cornerY / TILE_SIZE, 29),
            });
          }
        }
      }
    }
    for (const accent of seamAccents.values())
      this.environmentArt.drawTerrainSeam(ctx, accent.x, accent.y, accent.variation);
    this.environmentArt.paintWater(ctx, bounds, this.world);
    for (const plant of waterPlants) {
      this.environmentArt.drawWaterPlants(ctx, plant.x, plant.y, plant.variation, plant.shore);
    }
    // Draw complete scenery after every ground tile, including groups anchored offscreen.
    const getScenery = (tx: number, ty: number): TileKind => {
      if (this.world.mode === 'arena' && (tx < -10 || tx > 9 || ty < -8 || ty > 7)) return 'grass';
      return this.world.getTile(tx, ty);
    };
    for (let ty = Math.floor(bounds.top / TILE_SIZE / 2) * 2; ty <= Math.floor(bounds.bottom / TILE_SIZE); ty += 2) {
      for (let tx = Math.floor(bounds.left / TILE_SIZE / 2) * 2; tx <= Math.floor(bounds.right / TILE_SIZE); tx += 2) {
        for (const group of sceneryGroups(getScenery, tx, ty)) {
          this.environmentArt.draw(ctx, group.tile, group.x * TILE_SIZE, group.y * TILE_SIZE,
            noise(group.x, group.y), 0, group.width, group.height);
        }
      }
    }
  }

  private drawWater(tx: number, ty: number, x: number, y: number, _time: number, ctx = this.ctx): number {
    const shore = shorelineMask((nx, ny) => this.world.getTile(nx, ny), tx, ty);
    this.environmentArt.draw(ctx, 'water', x, y, noise(tx, ty), shore);
    return shore;
  }

  private drawArenaGate(time: number, state?: ArenaGateState): void {
    if (!this.visible(ARENA_GATE)) return;
    const { ctx } = this;
    const { x, y, radius } = ARENA_GATE;
    ctx.save();
    ctx.fillStyle = 'rgba(80, 88, 95, 0.26)';
    circle(ctx, x, y, radius); ctx.fill();
    ctx.strokeStyle = state?.phase === 'countdown' ? '#ffe3a0' : '#a5d9e8';
    ctx.lineWidth = 3;
    circle(ctx, x, y, radius); ctx.stroke();
    ctx.setLineDash([5, 9]); ctx.lineWidth = 1;
    circle(ctx, x, y, radius - 10); ctx.stroke(); ctx.setLineDash([]);
    if (state?.startsAt) {
      const progress = Math.max(0, Math.min(1, 1 - (state.startsAt - time) / ARENA_GATE.countdownMs));
      ctx.strokeStyle = '#ffe3a0'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(x, y, radius + 7, -Math.PI / 2, -Math.PI / 2 + progress * TAU); ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.fillStyle = '#e5f2f475';
    ctx.font = '700 15px system-ui'; ctx.fillText('ARENA 1 VS 1', x, y - radius - 22);
    ctx.font = '12px system-ui'; ctx.fillText('Entra nel cerchio', x, y + radius + 24);
    ctx.font = '700 28px system-ui'; ctx.fillText('⚔', x, y + 9);
    ctx.restore();
  }

  // Puoi impostare questo booleano a true/false per accendere o spegnere il meteo
 // Puoi impostare questo booleano a true/false per accendere o spegnere il meteo
  isRaining = true;

  private drawRain(time: number): void {
    if (!this.isRaining) return;
    const { ctx, width, height } = this;
    ctx.save();

    // -------------------------------------------------------------
    // 1. FILTRO ATMOSFERICO TEMPORALESCO
    // -------------------------------------------------------------
    ctx.fillStyle = 'rgba(18, 32, 44, 0.22)';
    ctx.fillRect(0, 0, width, height);

    // -------------------------------------------------------------
    // 2. GOCCE DI PIOGGIA NELL'ARIA (Densità dinamica proporzionale allo zoom)
    // -------------------------------------------------------------
    const wind = 0.22;
    // Calcola le gocce in base all'area reale: la fittezza della pioggia non cambia mai!
    const dropCount = Math.round((width * height) / 4600);

    ctx.strokeStyle = 'rgba(215, 238, 255, 0.42)';
    ctx.lineWidth = 0.8;
    ctx.lineCap = 'round';
    ctx.beginPath();

    const camOffsetX = this.camera.x * this.zoom * 0.4;
    const camOffsetY = this.camera.y * this.zoom * 0.4;

    for (let i = 0; i < dropCount; i++) {
      const seed = i * 7919;
      const speed = 1.1 + (i % 4) * 0.25;
      const len = 14 + (i % 3) * 6;

      const x = (Math.sin(seed) * 10000 + time * (speed * wind * 1.5) - camOffsetX) % width;
      const y = (Math.cos(seed) * 10000 + time * (speed * 1.4) - camOffsetY) % height;

      const px = x < 0 ? x + width : x;
      const py = y < 0 ? y + height : y;

      ctx.moveTo(px, py);
      ctx.lineTo(px + len * wind, py + len);
    }
    ctx.stroke();

    // -------------------------------------------------------------
    // 3. SCHIZZI CHE TOCCANO IL TERRENO (Densità costante e ancorati 1:1)
    // -------------------------------------------------------------
    // La griglia nel mondo si adatta allo zoom così la frequenza degli schizzi a video resta uniforme
    const CELL = 110 / this.zoom;
    const viewW = width / this.zoom;
    const viewH = height / this.zoom;

    const startGX = Math.floor((this.camera.x - viewW / 2 - CELL) / CELL);
    const endGX = Math.ceil((this.camera.x + viewW / 2 + CELL) / CELL);
    const startGY = Math.floor((this.camera.y - viewH / 2 - CELL) / CELL);
    const endGY = Math.ceil((this.camera.y + viewH / 2 + CELL) / CELL);

    ctx.lineWidth = 1;

    for (let gy = startGY; gy <= endGY; gy++) {
      for (let gx = startGX; gx <= endGX; gx++) {
        const seed = noise(gx, gy, 31);
        if (seed < 0.65) continue; // Mantiene la percentuale di schizzi bilanciata

        const cycle = (time * 0.0028 + seed * 10) % 1;

        // Coordinate fisse del terreno nel mondo
        const worldX = gx * CELL + noise(gx, gy, 1) * CELL;
        const worldY = gy * CELL + noise(gx, gy, 2) * CELL;

        // Proiezione a schermo bloccata sul terreno (nessun slittamento)
        const posX = (worldX - this.camera.x) * this.zoom + width / 2;
        const posY = (worldY - this.camera.y) * this.zoom + height / 2;

        const r = cycle * 6.5;
        const alpha = Math.sin((1 - cycle) * Math.PI * 0.5) * 0.45;

        ctx.strokeStyle = `rgba(220, 245, 255, ${alpha})`;
        ctx.beginPath();
        ctx.ellipse(posX, posY, r, r * 0.38, 0, 0, TAU);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawDungeonFlames(time: number, locks: BossLockState[] = []): void {
    const { ctx } = this;
    const drawn = new Set<string>();
    for (const lock of locks) {
      if (!lock.locked) continue;
      const dungeon = DUNGEON_BY_BOSS_ID.get(lock.bossId);
      if (!dungeon) continue;
      const group = `${dungeon.id}:${dungeon.encounterGroupId ?? dungeon.bossId}`;
      if (drawn.has(group)) continue;
      drawn.add(group);
      const dangerous = lock.relation === 'participant' || lock.relation === 'eliminated';
      const base = dangerous ? '#6d28d9' : '#237a3b';
      const middle = dangerous ? '#b45cff' : '#55d96f';
      const core = dangerous ? '#f1d7ff' : '#dcffe2';
      for (const gate of dungeonFlames(dungeon)) {
        if (!this.visible(gate)) continue;
        const flames = Math.max(3, Math.round(gate.length / 15));
        ctx.save();
        ctx.translate(gate.x, gate.y);
        ctx.rotate(inwardFlameAngle(gate, dungeon.layout.bounds));
        ctx.globalCompositeOperation = 'screen';
        ctx.shadowColor = middle;
        ctx.shadowBlur = dangerous ? 15 : 9;
        ctx.strokeStyle = base;
        ctx.lineWidth = dangerous ? 7 : 4;
        ctx.beginPath(); ctx.moveTo(-gate.length / 2, 0); ctx.lineTo(gate.length / 2, 0); ctx.stroke();
        for (let index = 0; index < flames; index++) {
          const x = -gate.length / 2 + gate.length * (index + 0.5) / flames;
          const wave = Math.sin(time * 0.008 + index * 1.73 + gate.x * 0.01 + gate.y * 0.013);
          const height = (dangerous ? 27 : 15) + wave * (dangerous ? 5 : 3);
          const width = gate.length / flames * (dangerous ? 0.72 : 0.58);
          ctx.fillStyle = middle;
          polygon(ctx, [x - width / 2, 3, x - width * 0.42, height * 0.46, x, height,
            x + width * 0.38, height * 0.43, x + width / 2, 3]);
          ctx.fill();
          ctx.fillStyle = core;
          polygon(ctx, [x - width * 0.18, 2, x, height * 0.68, x + width * 0.17, 2]);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  private drawDungeons(): void {
    for (const definition of DUNGEON_DEFINITIONS) this.drawDungeon(definition);
  }

  private drawDungeon(definition: DungeonDefinition): void {
    const { ctx } = this;
    ctx.save();
    // Weathered stones guide the eye along the trail without floating sign text.
    const normal = dungeonApproachNormal(definition);
    for (const [index, progress] of definition.approach.markers.entries()) {
      const center = dungeonApproachPoint(definition, progress), side = index % 2 ? 1 : -1;
      const x = center.x + normal.x * side * 92, y = center.y + normal.y * side * 92;
      if (!this.visible({ x, y })) continue;
      ctx.fillStyle = 'rgba(25,34,27,.24)'; ctx.beginPath(); ctx.ellipse(x + 5, y + 9, 18, 7, -.2, 0, TAU); ctx.fill();
      ctx.fillStyle = definition.theme.markerStone; ctx.strokeStyle = definition.theme.markerEdge; ctx.lineWidth = 2;
      polygon(ctx, [x - 10, y + 8, x - 8, y - 26, x + 2, y - 37, x + 11, y - 21, x + 9, y + 8]); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = definition.theme.markerRune; ctx.lineWidth = 1.5; polygon(ctx, [x, y - 26, x + 5, y - 17, x, y - 8, x - 5, y - 17]); ctx.stroke();
    }
    ctx.restore();
  }

  private drawCrossroads(time: number): void {
    // -------------------------------------------------------------
    // OTTIMIZZAZIONE (CULLING): Se è fuori schermo, esci subito!
    // -------------------------------------------------------------
    const margin = OUTPOST.radius + 70; // Raggio + margine per fumi e bagliori
    if (
      this.bounds.right < OUTPOST.x - margin ||
      this.bounds.left > OUTPOST.x + margin ||
      this.bounds.bottom < OUTPOST.y - margin ||
      this.bounds.top > OUTPOST.y + margin
    ) {
      return;
    }

    const { ctx } = this;
    ctx.save();

    // -------------------------------------------------------------
    // FUNZIONE DI SUPPORTO PER FIAMME REALISTICHE E FLUIDE
    // -------------------------------------------------------------
    const drawRealisticFlame = (x: number, y: number, w: number, h: number, seed: number) => {
      // Tempo rallentato + oscillazione armonica asincrona (3 frequenze)
      const t = time * 0.0042;
      const sway1 = Math.sin(t + seed) * 0.5 + Math.sin(t * 2.1 + seed * 1.7) * 0.3 + Math.sin(t * 4.3 + seed * 3.1) * 0.2;
      const sway2 = Math.cos(t * 0.85 + seed * 2.2) * 0.5 + Math.sin(t * 1.9 + seed * 0.9) * 0.35 + Math.cos(t * 3.7) * 0.15;
      const breathe = Math.sin(t * 1.3 + seed * 1.5) * 0.12 + 0.88;

      const curH = h * (0.85 + breathe * 0.25);
      const tipX = sway1 * (w * 0.7);
      const tipY = -curH;

      // 1. Bagliore caldo e morbido sul terreno/aria
      const glowR = Math.max(w * 3.2, curH * 1.55);
      const g = ctx.createRadialGradient(x, y - curH * 0.3, 2, x, y - curH * 0.3, glowR);
      g.addColorStop(0, 'rgba(255, 175, 45, 0.42)');
      g.addColorStop(0.45, 'rgba(225, 75, 20, 0.12)');
      g.addColorStop(1, 'rgba(200, 40, 10, 0)');
      ctx.fillStyle = g;
      circle(ctx, x, y - curH * 0.3, glowR);
      ctx.fill();

      // 2. Lingua esterna (Rosso cremisi e arancio scuro fluido)
      ctx.fillStyle = '#db4716';
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.bezierCurveTo(
        x - w * 1.1 + sway2 * 4, y - curH * 0.35,
        x - w * 0.4 + sway1 * 5, y - curH * 0.75,
        x + tipX, y + tipY
      );
      ctx.bezierCurveTo(
        x + w * 0.45 + sway2 * 5, y - curH * 0.7,
        x + w * 1.05 - sway1 * 3, y - curH * 0.35,
        x + w, y
      );
      ctx.closePath();
      ctx.fill();

      // 3. Lingua intermedia (Arancio vivo)
      ctx.fillStyle = '#f0841f';
      const midW = w * 0.68;
      const midH = curH * 0.78;
      const midTipX = sway2 * (midW * 0.6);
      ctx.beginPath();
      ctx.moveTo(x - midW, y);
      ctx.bezierCurveTo(
        x - midW * 0.9, y - midH * 0.4,
        x - midW * 0.3 + sway1 * 3, y - midH * 0.75,
        x + midTipX, y - midH
      );
      ctx.bezierCurveTo(
        x + midW * 0.3 + sway2 * 3, y - midH * 0.7,
        x + midW * 0.9, y - midH * 0.4,
        x + midW, y
      );
      ctx.closePath();
      ctx.fill();

      // 4. Cuore interno candido (Giallo zafferano/bianco incandescente)
      ctx.fillStyle = '#fff194';
      const coreW = w * 0.36;
      const coreH = curH * 0.48;
      const coreTipX = (sway1 + sway2) * 0.5 * (coreW * 0.5);
      ctx.beginPath();
      ctx.moveTo(x - coreW, y);
      ctx.bezierCurveTo(
        x - coreW * 0.8, y - coreH * 0.4,
        x - coreW * 0.2, y - coreH * 0.8,
        x + coreTipX, y - coreH
      );
      ctx.bezierCurveTo(
        x + coreW * 0.2, y - coreH * 0.8,
        x + coreW * 0.8, y - coreH * 0.4,
        x + coreW, y
      );
      ctx.closePath();
      ctx.fill();

      // 5. Faville e scintille organiche (salgono fluide con dissolvenza a seno)
      const sparkCount = w > 12 ? 5 : 3;
      for (let s = 0; s < sparkCount; s++) {
        const sparkSpeed = 0.0016 + (s % 3) * 0.0005;
        const phase = (time * sparkSpeed + s * 0.35 + seed * 0.22) % 1;
        const drift = Math.sin(time * 0.0025 + s * 2.1 + seed) * (w * 0.75);
        const sx = x + tipX * 0.4 + drift * phase;
        const sy = y - curH * 0.4 - phase * (curH * 1.5);
        const alpha = Math.sin(phase * Math.PI) * 0.85;
        const size = (1 - phase * 0.45) * (w > 12 ? 1.7 : 1.2);

        ctx.fillStyle = s % 2 === 0 ? `rgba(255, 235, 140, ${alpha})` : `rgba(255, 140, 50, ${alpha})`;
        circle(ctx, sx, sy, size);
        ctx.fill();
      }
    };

    // -------------------------------------------------------------
    // 1. TERRENO: Bagliore e Pavimentazione a Ciottoli
    // -------------------------------------------------------------
    const campGlow = ctx.createRadialGradient(OUTPOST.x, OUTPOST.y, 10, OUTPOST.x, OUTPOST.y, OUTPOST.radius);
    campGlow.addColorStop(0, 'rgba(224, 166, 85, 0.08)');
    campGlow.addColorStop(0.7, 'rgba(110, 160, 120, 0.04)');
    campGlow.addColorStop(1, 'rgba(40, 50, 40, 0)');
    ctx.fillStyle = campGlow;
    circle(ctx, OUTPOST.x, OUTPOST.y, OUTPOST.radius);
    ctx.fill();

    const stoneOffsets = [
      [-50, -20], [-30, -60], [40, -45], [60, 20], [-45, 55], [35, 75],
      [-110, 5], [120, -10], [10, -120], [-15, 130], [-80, -70], [75, -80]
    ];
    ctx.fillStyle = 'rgba(75, 80, 70, 0.35)';
    for (let i = 0; i < stoneOffsets.length; i++) {
      const [sx, sy] = stoneOffsets[i];
      const s = 7 + (i % 5) * 2;
      polygon(ctx, [sx - s, sy - s * 0.6, sx + s * 0.8, sy - s * 0.5, sx + s, sy + s * 0.7, sx - s * 0.7, sy + s * 0.6]);
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(60, 50, 40, 0.4)';
    ctx.lineWidth = 6;
    ctx.setLineDash([20, 35, 10, 25]);
    circle(ctx, OUTPOST.x, OUTPOST.y, OUTPOST.radius);
    ctx.stroke();
    ctx.setLineDash([]);

    // -------------------------------------------------------------
    // 2. CONFINE: Rocce e Menhir Irregolari
    // -------------------------------------------------------------
    const numMonoliths = 22;
    for (let i = 0; i < numMonoliths; i++) {
      const baseAngle = (i * TAU) / numMonoliths;
      if (baseAngle > 1.3 && baseAngle < 1.84) continue; // Varco PvP aperto

      const angle = baseAngle + Math.sin(i * 12.3) * 0.04;
      const r = OUTPOST.radius + Math.cos(i * 7.1) * 7;
      const x = OUTPOST.x + Math.cos(angle) * r;
      const y = OUTPOST.y + Math.sin(angle) * r;

      const rockH = 12 + (i % 4) * 4;
      const rockW = 8 + (i % 3) * 3;
      const lean = Math.sin(i * 4.2) * 0.3;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 2 + lean);

      ctx.fillStyle = 'rgba(20, 25, 20, 0.3)';
      polygon(ctx, [-rockW, 2, rockW, 2, rockW + 4, 8, -rockW - 4, 8]);
      ctx.fill();

      ctx.fillStyle = i % 2 === 0 ? '#4c5248' : '#57564d';
      polygon(ctx, [-rockW, 2, -rockW * 0.7, -rockH, rockW * 0.5, -rockH * 0.9, rockW, 2]);
      ctx.fill();

      ctx.fillStyle = '#686f62';
      polygon(ctx, [-rockW * 0.7, -rockH, 0, -rockH * 0.95, rockW * 0.2, 0, -rockW * 0.5, 0]);
      ctx.fill();

      if (i % 3 === 0) {
        ctx.strokeStyle = '#93b584';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -rockH * 0.6);
        ctx.lineTo(0, -2);
        ctx.moveTo(-3, -rockH * 0.4);
        ctx.lineTo(3, -rockH * 0.3);
        ctx.stroke();
      }
      ctx.restore();
    }

    // -------------------------------------------------------------
    // 3. BRACIERI PERIMETRALI (Con Fiamme Fluide e Lente)
    // -------------------------------------------------------------
    const brazierAngles = [
      -Math.PI * 0.75, -Math.PI * 0.5, -Math.PI * 0.25, 0,
      Math.PI * 0.25, Math.PI * 0.42, Math.PI * 0.58, Math.PI * 0.75, Math.PI
    ];

    for (let b = 0; b < brazierAngles.length; b++) {
      const bAngle = brazierAngles[b];
      const bx = OUTPOST.x + Math.cos(bAngle) * OUTPOST.radius;
      const by = OUTPOST.y + Math.sin(bAngle) * OUTPOST.radius;

      ctx.save();
      ctx.translate(bx, by);

      // Treppiede / braciere in ferro battuto
      ctx.fillStyle = '#222520';
      ctx.fillRect(-7, 2, 14, 4);
      polygon(ctx, [-6, 3, -10, 11, -7, 11, -4, 3]); ctx.fill();
      polygon(ctx, [6, 3, 10, 11, 7, 11, 4, 3]); ctx.fill();
      polygon(ctx, [-9, 2, 9, 2, 6, -3, -6, -3]); ctx.fill();

      // Brace scura
      ctx.fillStyle = '#7a2512';
      circle(ctx, 0, -1, 5);
      ctx.fill();

      // Disegna la fiamma fluida per il braciere
      drawRealisticFlame(0, -2, 6.5, 17, b * 4.3);

      ctx.restore();
    }

    // -------------------------------------------------------------
    // 4. FALÒ CENTRALE DELL'ACCAMPAMENTO
    // -------------------------------------------------------------
    const fireX = OUTPOST.x, fireY = OUTPOST.y + 38;
    ctx.save();
    ctx.translate(fireX, fireY);

    // Cerchio di sassi attorno al fuoco
    for (let r = 0; r < 8; r++) {
      const rockAng = (r * TAU) / 8;
      ctx.fillStyle = '#545248';
      circle(ctx, Math.cos(rockAng) * 22, Math.sin(rockAng) * 16, 5);
      ctx.fill();
    }

    // Ceppi di legna incrociati
    ctx.strokeStyle = '#3d2516';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-14, -8); ctx.lineTo(14, 8);
    ctx.moveTo(-14, 8); ctx.lineTo(14, -8);
    ctx.stroke();

    // Brace viva
    ctx.fillStyle = '#b33112';
    circle(ctx, 0, 0, 11);
    ctx.fill();

    // Grande fiamma centrale fluida e calda
    drawRealisticFlame(0, 0, 12, 30, 99.1);

    ctx.restore();

    // -------------------------------------------------------------
    // 5. TESTI E INDICAZIONI
    // -------------------------------------------------------------
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f5e8c4';
    ctx.shadowColor = 'rgba(20, 25, 18, 0.8)';
    ctx.shadowBlur = 4;
    ctx.fillText('AVAMPOSTO DEL CROCEVIA', OUTPOST.x, OUTPOST.y + 120);

    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillStyle = '#c5e2b8';
    ctx.fillText('ZONA SICURA', OUTPOST.x, OUTPOST.y + 137);

    ctx.fillStyle = '#f59a78';
    ctx.shadowColor = 'rgba(80, 20, 10, 0.7)';
    ctx.shadowBlur = 6;
    ctx.fillText('↓ PVP LIBERO', OUTPOST.x, OUTPOST.y + OUTPOST.radius + 32);

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  private drawPickup(pickup: Pickup, time: number): void {
    const { ctx } = this;
    const bob = Math.sin(time * 0.0025 + pickup.x) * 2.5;
    ctx.save(); ctx.translate(pickup.x, pickup.y);
    ctx.fillStyle = 'rgba(26,38,25,0.2)'; ctx.beginPath(); ctx.ellipse(0, 7, 11, 4, 0, 0, TAU); ctx.fill();
    const glow = ctx.createRadialGradient(0, bob, 2, 0, bob, 20);
    glow.addColorStop(0, `${PICKUP_COLORS[pickup.kind]}44`); glow.addColorStop(1, `${PICKUP_COLORS[pickup.kind]}00`);
    ctx.fillStyle = glow; circle(ctx, 0, bob, 20); ctx.fill();
    ctx.translate(0, bob);
    polygon(ctx, [0, -10, 8, 0, 0, 10, -8, 0]);
    ctx.fillStyle = '#394938'; ctx.fill();
    ctx.strokeStyle = PICKUP_COLORS[pickup.kind]; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = PICKUP_COLORS[pickup.kind]; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (pickup.kind === 'heal') {
      ctx.moveTo(-3.5, 0); ctx.lineTo(3.5, 0); ctx.moveTo(0, -3.5); ctx.lineTo(0, 3.5);
    } else if (pickup.kind === 'haste') {
      ctx.moveTo(1, -5); ctx.lineTo(-3, 0); ctx.lineTo(2, 0); ctx.lineTo(-1, 5);
    } else if (pickup.kind === 'power') {
      ctx.moveTo(-3, 3); ctx.lineTo(0, -4); ctx.lineTo(3, 3); ctx.moveTo(-2, 1); ctx.lineTo(2, 1);
    } else {
      ctx.moveTo(-3, -3); ctx.lineTo(3, 3); ctx.moveTo(3, -3); ctx.lineTo(-3, 3);
    }
    ctx.stroke(); ctx.restore();
  }

  private drawActor(actor: Actor, time: number, self: boolean, allied: boolean, selected: boolean,
    hitTargets: ReadonlySet<string>, moveDirection?: Vec2 | null, detailed = true): void {
    const { ctx } = this;
    const dead = actor.hp <= 0;
    const color = dead ? '#91968a' : CLASSES[actor.classId].color;
    const r = actor.radius || PLAYER_RADIUS;
    ctx.save(); ctx.translate(actor.x, actor.y);
    if (actor.hidden) ctx.globalAlpha = self || allied ? 0.58 : 0.32;
    if (actor.effects.some(effect => effect.kind === 'root' && effect.until > time)) {
      ctx.strokeStyle = '#6ebd57';
      ctx.lineWidth = 3;
      circle(ctx, 0, 0, r + 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r, r); ctx.lineTo(-r - 4, r + 8);
      ctx.moveTo(r, r); ctx.lineTo(r + 4, r + 8);
      ctx.moveTo(0, r + 3); ctx.lineTo(0, r + 11);
      ctx.stroke();
    }
    if (dead) ctx.globalAlpha = 0.45;
    if (detailed) {
      ctx.fillStyle = 'rgba(36, 48, 37, 0.28)';
      ctx.beginPath(); ctx.ellipse(1, 13, r + 5, r * 0.56, 0, 0, TAU); ctx.fill();
    }
    if (self || allied || selected) {
      ctx.strokeStyle = self ? '#f1e7c2' : allied ? '#abd6c0' : '#f0b7a0';
      ctx.lineWidth = selected ? 2 : 1.5;
      if (!self && !selected) ctx.setLineDash([3, 4]);
      circle(ctx, 0, 0, r + 7); ctx.stroke(); ctx.setLineDash([]);
    }
    if (selected) {
      polygon(ctx, [-4, -r - 38, 4, -r - 38, 0, -r - 33]);
      ctx.fillStyle = '#f5dcba'; ctx.fill();
    }
    if (actor.spawnProtectedUntil > time || actor.effects.some(effect => effect.kind === 'shield' && effect.until > time)) {
      ctx.strokeStyle = actor.spawnProtectedUntil > time ? 'rgba(199,235,213,0.65)' : '#f1dfad'; ctx.lineWidth = 2;
      circle(ctx, 0, 0, r + 12 + Math.sin(time * 0.005) * 1.5); ctx.stroke();
      ctx.fillStyle = 'rgba(255,242,195,0.06)'; ctx.fill();
    }
    if (actor.effects.some(effect => effect.kind === 'power' && effect.until > time)) {
      ctx.strokeStyle = '#eacf82'; ctx.lineWidth = 1; ctx.setLineDash([3, 6]);
      circle(ctx, 0, 0, r + 10); ctx.stroke(); ctx.setLineDash([]);
    }
    if (actor.effects.some(effect => effect.kind === 'weakness' && effect.until > time)) {
      ctx.strokeStyle = '#c798db'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-5, r + 13); ctx.lineTo(0, r + 17); ctx.lineTo(5, r + 13); ctx.stroke();
    }
    if (actor.effects.some(effect => effect.kind === 'slow' && effect.until > time)) {
      ctx.strokeStyle = '#9ddfea'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-r, r + 3); ctx.lineTo(r, r + 3); ctx.stroke();
    }
    if (actor.effects.some(effect => effect.kind === 'haste' && effect.until > time)) {
      ctx.save(); ctx.rotate(actor.aim);
      ctx.strokeStyle = 'rgba(180,224,224,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-r - 5, -5); ctx.lineTo(-r - 15, -5); ctx.moveTo(-r - 5, 5); ctx.lineTo(-r - 12, 5); ctx.stroke(); ctx.restore();
    }
    if (actor.kind === 'npc') this.drawNpc(actor, time, color);
    else this.drawPlayer(actor, color, dead, time, moveDirection);
    if (!dead && hitTargets.has(actor.id)) {
      circle(ctx, 0, 0, r + 2); ctx.fillStyle = 'rgba(255,241,221,0.48)'; ctx.fill();
    }
    if (self && !dead) {
      ctx.save(); ctx.rotate(actor.aim);
      polygon(ctx, [r + 15, -3, r + 20, 0, r + 15, 3]);
      ctx.fillStyle = '#f2eacb'; ctx.fill(); ctx.restore();
    }
    if (actor.kind === 'player' || selected || actor.hp < actor.maxHp || actor.npcKind === 'boss') {
      const barWidth = actor.kind === 'player' ? 42 : 32;
      const barY = -r - 11;
      ctx.fillStyle = 'rgba(24,32,24,0.75)'; ctx.fillRect(-barWidth / 2 - 1, barY - 1, barWidth + 2, 5);
      ctx.fillStyle = self || allied ? '#c7d59d' : actor.kind === 'npc' ? '#dab07f' : '#d49381';
      ctx.fillRect(-barWidth / 2, barY, barWidth * Math.max(0, Math.min(1, actor.hp / actor.maxHp)), 3);
      if (actor.kind === 'player' && detailed) {
        ctx.textAlign = 'center'; ctx.font = `${self ? '600' : '500'} 10px Inter, system-ui, sans-serif`;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(34,43,29,0.65)';
        const label = `${actor.name.slice(0, 20)}${self ? ' · tu' : ''}`;
        ctx.strokeText(label, 0, barY - 7); ctx.fillStyle = self ? '#faf2d8' : allied ? '#ceebd6' : '#e7e6d7'; ctx.fillText(label, 0, barY - 7);
      } else if (selected || actor.npcKind === 'boss') {
        ctx.textAlign = 'center'; ctx.font = '500 9px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#f0e8cf'; ctx.fillText(actor.npcKind === 'boss' && dead ? `Cadavere · ${Math.max(0, Math.ceil((actor.deadUntil - time) / 1000))}s` : `${actor.name} · ${actor.level}`, 0, barY - 6);
      }
    }
    if (actor.hidden && self) {
      ctx.globalAlpha = 1; ctx.font = '500 9px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#e0e8be'; ctx.fillText('NASCOSTO', 0, r + 29);
    }
    ctx.restore();
  }

  private drawPlayer(actor: Actor, color: string, dead: boolean, time: number, moveDirection?: Vec2 | null): void {
    const { ctx } = this;
    const r = actor.radius;
    const sprite = this.classSprites.get(actor.classId);
    if (sprite && !dead) {
      const previous = this.classMotion.get(actor.id);
      const dx = previous ? actor.x - previous.x : 0;
      const dy = previous ? actor.y - previous.y : 0;
      const distanceMoved = Math.hypot(dx, dy);
      const controlledDirection = moveDirection !== undefined;
      const moving = actor.spriteMoving ?? (controlledDirection ? Math.hypot(moveDirection?.x ?? 0, moveDirection?.y ?? 0) > 0 : distanceMoved > 0.02);
      let row = actor.spriteRow ?? previous?.row ?? 0;
      if (moving && actor.spriteRow === undefined) {
        const directionX = controlledDirection ? moveDirection!.x : dx;
        const directionY = controlledDirection ? moveDirection!.y : dy;
        row = playerSpriteDirectionRow(directionX, directionY, row, controlledDirection ? this.touchQuery.matches : true);
      }
      const startedAt = moving && (!previous || !previous.moving || previous.row !== row || Math.hypot(actor.x - previous.x, actor.y - previous.y) > 20)
        ? time : previous?.startedAt ?? time;
      this.classMotion.set(actor.id, { x: actor.x, y: actor.y, row, startedAt, moving });
      const frame = moving ? Math.floor((time - startedAt) / 130) % SPRITE_COLUMNS : 0;
      const cachedFrame = sprite.frames[row * SPRITE_COLUMNS + frame];
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cachedFrame, -DRAW_SIZE_SIZE / 2, -DRAW_SIZE_SIZE / 2, DRAW_SIZE_SIZE, DRAW_SIZE_SIZE);
      return;
    }
    ctx.fillStyle = dead ? '#697066' : '#333e35';
    circle(ctx, 0, 0, r); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    if (dead) {
      ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(4, 4); ctx.moveTo(4, -4); ctx.lineTo(-4, 4); ctx.stroke(); return;
    }
    ctx.fillStyle = color;
    if (actor.classId === 'mage') {
      polygon(ctx, [0, -10, 9, 7, -9, 7]); ctx.fill();
      ctx.strokeStyle = '#4c455e'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(0, 3); ctx.stroke();
      ctx.save(); ctx.rotate(actor.aim); ctx.strokeStyle = '#d7c7ea'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(7, 10); ctx.lineTo(24, 10); ctx.stroke();
      circle(ctx, 25, 10, 3.4); ctx.fillStyle = '#ece2ff'; ctx.fill(); ctx.restore();
    } else if (actor.classId === 'warrior') {
      polygon(ctx, [-8, -6, -3, -10, 3, -10, 8, -6, 6, 8, -6, 8]); ctx.fill();
      ctx.fillStyle = '#53483b'; ctx.fillRect(-4, -3, 8, 2);
      ctx.save(); ctx.rotate(actor.aim);
      polygon(ctx, [8, 8, 27, 6, 32, 9, 27, 12, 8, 10]); ctx.fillStyle = '#e9ded0'; ctx.fill();
      ctx.strokeStyle = '#ac8760'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(12, 4); ctx.lineTo(12, 14); ctx.stroke(); ctx.restore();
    } else if (actor.classId === 'paladin'){
      polygon(ctx, [-8, -8, 8, -8, 8, 2, 4, 8, 0, 11, -4, 8, -8, 2]); ctx.fill();
      ctx.strokeStyle = '#74643d'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 6); ctx.moveTo(-4, -1); ctx.lineTo(4, -1); ctx.stroke();
      ctx.save(); ctx.rotate(actor.aim); ctx.strokeStyle = '#d9c38e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(24, 10); ctx.stroke();
      ctx.fillStyle = '#eaddb3'; ctx.fillRect(20, 4, 8, 12); ctx.restore();
    }
    else if (actor.classId === 'hunter') {
      // Tunica verde foresta e cappuccio da cacciatore
      polygon(ctx, [-7, -7, 0, -11, 7, -7, 7, 7, -7, 7]);
      ctx.fill();
      ctx.strokeStyle = '#394d33';
      ctx.lineWidth = 1.3;
      ctx.stroke();
      
      // Arco impugnato e freccia puntata nella direzione di mira
      ctx.save();
      ctx.rotate(actor.aim);
      ctx.strokeStyle = '#855d37';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(12, 0, 15, -Math.PI * 0.38, Math.PI * 0.38);
      ctx.stroke();

      // Corda tesa
      ctx.strokeStyle = '#e2ebd8';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(12 + Math.cos(-Math.PI * 0.38) * 15, Math.sin(-Math.PI * 0.38) * 15);
      ctx.lineTo(6, 0);
      ctx.lineTo(12 + Math.cos(Math.PI * 0.38) * 15, Math.sin(Math.PI * 0.38) * 15);
      ctx.stroke();

      // Freccia pronta
      ctx.strokeStyle = '#effae8';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(23, 0); ctx.stroke();
      polygon(ctx, [23, -2.5, 27, 0, 23, 2.5]);
      ctx.fillStyle = '#aff598';
      ctx.fill();
      ctx.restore();
    }
    
  }

  private drawNpc(actor: Actor, time: number, color: string): void {
    const { ctx } = this;
    const r = actor.radius;
    const spriteKey = actor.npcKind === 'boss' ? `boss:${actor.bossSkin}` : actor.npcKind;
    const sprite = spriteKey ? this.npcSprites.get(spriteKey) : undefined;
    if (sprite && actor.hp > 0) {
      const previous = this.classMotion.get(actor.id);
      const dx = previous ? actor.x - previous.x : 0;
      const dy = previous ? actor.y - previous.y : 0;
      const moving = actor.spriteMoving ?? Math.hypot(dx, dy) > 0.02;
      let row = actor.spriteRow ?? previous?.row ?? 0;
      if (moving && actor.spriteRow === undefined) row = spriteDirectionRow(dx, dy, row);
      const startedAt = moving && (!previous || !previous.moving || previous.row !== row)
        ? time : previous?.startedAt ?? time;
      this.classMotion.set(actor.id, { x: actor.x, y: actor.y, row, startedAt, moving });
      const frame = moving ? Math.floor((time - startedAt) / 130) % SPRITE_COLUMNS : 0;
      const drawSize = actor.npcKind === 'boss' ? BOSS_DRAW_SIZE : NPC_DRAW_SIZE;
      const cachedFrame = sprite.frames[row * SPRITE_COLUMNS + frame];
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cachedFrame, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      return;
    }
    ctx.strokeStyle = '#3c483b'; ctx.lineWidth = 1.8;
    if (actor.npcKind === 'boss') {
      if (actor.hp <= 0) {
        ctx.fillStyle = '#9c9479';
        for (const [x, y] of [[-22, 0], [-2, 7], [20, -2]]) { polygon(ctx, [x - 10, y - 8, x + 9, y - 7, x + 12, y + 9, x - 7, y + 12]); ctx.fill(); ctx.stroke(); }
      } else if (actor.bossSkin === 'stone-warden') {
        ctx.fillStyle = '#a99b76'; polygon(ctx, [-29, -12, -20, -28, 20, -28, 29, -12, 24, 23, -24, 23]); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#675b48'; ctx.fillRect(-14, -19, 28, 22);
        ctx.fillStyle = '#eac773'; ctx.fillRect(-10, -12, 6, 4); ctx.fillRect(4, -12, 6, 4);
        ctx.strokeStyle = '#e6c279'; polygon(ctx, [0, 6, 7, 14, 0, 23, -7, 14]); ctx.stroke();
      } else {
        // Asset-independent fallback used by newly configured bosses.
        ctx.fillStyle = '#443a49'; polygon(ctx, [-24, -19, -12, -29, 0, -22, 12, -29, 24, -19, 27, 18, 0, 29, -27, 18]); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#d47a56'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-13, -21); ctx.quadraticCurveTo(-28, -36, -34, -19); ctx.moveTo(13, -21); ctx.quadraticCurveTo(28, -36, 34, -19); ctx.stroke();
        ctx.fillStyle = '#f0a16e'; ctx.fillRect(-10, -10, 6, 4); ctx.fillRect(4, -10, 6, 4);
        ctx.save(); ctx.rotate(actor.aim); ctx.strokeStyle = '#b86b50'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(34, 8); ctx.stroke(); ctx.restore();
      }
    } else if (actor.npcKind === 'wisp') {
      const bob = Math.sin(time * 0.003 + actor.x) * 2;
      polygon(ctx, [0, -r + bob, r * 0.7, bob, 0, r + bob, -r * 0.7, bob]);
      ctx.fillStyle = '#b4c6c5'; ctx.fill(); ctx.stroke();
      circle(ctx, 0, bob, 3); ctx.fillStyle = '#edf3db'; ctx.fill();
    } else if (actor.npcKind === 'sentinel') {
      polygon(ctx, [-r * 0.75, -r * 0.7, r * 0.55, -r, r, r * 0.2, r * 0.6, r * 0.8, -r * 0.7, r * 0.7, -r, -r * 0.1]);
      ctx.fillStyle = '#a5a18a'; ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e5c68c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-5, -1); ctx.lineTo(5, -1); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(0, 1, r, r * 0.8 + Math.sin(time * 0.003 + actor.y) * 0.8, 0, 0, TAU);
      ctx.fillStyle = actor.hp <= 0 ? color : '#a5b981'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(225,238,190,0.35)'; ctx.beginPath(); ctx.ellipse(-4, -4, 5, 2.5, -0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3f4a37'; circle(ctx, -4, 1, 1.5); ctx.fill(); circle(ctx, 4, 1, 1.5); ctx.fill();
    }
  }

  private drawProjectile(projectile: Projectile, time: number): void {
    const { ctx } = this;
    const angle = Math.atan2(projectile.vy, projectile.vx);
    const r = projectile.radius;
    ctx.save(); ctx.translate(projectile.x, projectile.y); ctx.rotate(angle);
    const trail = ctx.createLinearGradient(-r * 5, 0, r, 0);
    trail.addColorStop(0, `${projectile.color}00`); trail.addColorStop(1, `${projectile.color}aa`);
    ctx.fillStyle = trail;
    polygon(ctx, [-r * 5, 0, -r * 0.2, -r * 0.65, r, 0, -r * 0.2, r * 0.65]); ctx.fill();
    ctx.shadowColor = projectile.color; ctx.shadowBlur = 8;
    circle(ctx, 0, 0, r * (0.82 + Math.sin(time * 0.015) * 0.08));
    ctx.fillStyle = projectile.color; ctx.fill(); ctx.shadowBlur = 0;
    circle(ctx, r * 0.18, -r * 0.12, r * 0.36); ctx.fillStyle = '#fff6df'; ctx.fill();
    ctx.restore();
  }

  private drawGroundEvent(event: GameEvent, time: number): void {
    if (!this.visible(event) || event.kind === 'hit' || event.kind === 'pickup') return;
    const { ctx } = this;
    const progress = Math.max(0, Math.min(1, (time - event.at) / Math.max(1, event.duration)));
    const fade = 1 - progress;
    ctx.save(); ctx.translate(event.x, event.y); ctx.globalAlpha = fade;
    ctx.strokeStyle = event.color; ctx.fillStyle = event.color; ctx.lineWidth = 2;
    const radius = Math.max(12, event.radius);
    if (event.abilityKind === 'melee') {
      const angle = event.aim ?? 0;
      ctx.globalAlpha = fade * 0.15;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, radius, angle - 0.78, angle + 0.78); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = fade; ctx.lineWidth = 4 * fade + 1;
      ctx.beginPath(); ctx.arc(0, 0, radius * (0.68 + progress * 0.3), angle - 0.78 + progress * 0.9, angle + 0.78 + progress * 0.25); ctx.stroke();
    } else if (event.abilityKind === 'dash') {
      ctx.rotate(event.aim ?? 0);
      ctx.globalAlpha = fade * 0.7;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(-8, i * 10); ctx.lineTo(radius * (0.4 + progress * 0.6), i * 10); ctx.stroke();
      }
    } else if (event.abilityKind === 'projectile') {
      circle(ctx, 0, 0, 9 + progress * 17); ctx.stroke();
    } else {
      ctx.globalAlpha = fade * 0.1; circle(ctx, 0, 0, radius); ctx.fill();
      ctx.globalAlpha = fade * 0.9;
      circle(ctx, 0, 0, radius * (0.45 + progress * 0.55)); ctx.stroke();
      ctx.globalAlpha = fade * 0.35; ctx.lineWidth = 1;
      ctx.setLineDash([5, 8]); circle(ctx, 0, 0, radius); ctx.stroke(); ctx.setLineDash([]);
      if (event.abilityKind === 'heal' || event.kind === 'heal') {
        ctx.globalAlpha = fade * 0.6; ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const angle = i * Math.PI / 2 + 0.7;
          const x = Math.cos(angle) * radius * 0.6, y = Math.sin(angle) * radius * 0.6 - progress * 15;
          ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  private drawFloatingEvent(event: GameEvent, time: number): void {
    if (!this.visible(event)) return;
    if (event.kind !== 'hit' && event.kind !== 'heal' && event.kind !== 'pickup' && event.kind !== 'death' && event.kind !== 'respawn') return;
    const { ctx } = this;
    const progress = Math.max(0, Math.min(1, (time - event.at) / Math.max(1, event.duration)));
    const amount = event.amount;
    const label = amount !== undefined ? `${event.kind === 'heal' ? '+' : '−'}${Math.round(amount)}`
      : event.text || (event.kind === 'death' ? 'SCONFITTO' : event.kind === 'respawn' ? 'RINASCITA' : '');
    if (!label) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (1 - progress) * 2.5);
    ctx.font = `${amount !== undefined ? '700 14px' : '600 10px'} Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(30,37,28,0.75)'; ctx.fillStyle = event.color;
    const y = event.y - 27 - progress * 35;
    ctx.strokeText(label, event.x, y); ctx.fillText(label, event.x, y);
    ctx.restore();
  }

  private previewActors(classId: ClassId, time: number): Actor[] {
    const def = CLASSES[classId];
    const actor: Actor = {
      id: 'preview', kind: 'player', name: 'Viandante', classId,
      x: 0, y: 0, radius: PLAYER_RADIUS, hp: def.maxHp, maxHp: def.maxHp,
      resource: def.maxResource, maxResource: def.maxResource,
      aim: -0.6 + Math.sin(time * 0.0005) * 0.15, speed: def.speed, level: 1,
      xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0,
      deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 },
    };
    const previews: Actor[] = [actor];
    for (const [cx, cy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      for (const spawn of this.world.getChunk(cx, cy).npcs) {
        if (!this.visible(spawn)) continue;
        previews.push({
          ...actor, ...spawn, id: `preview:${spawn.id}`, kind: 'npc', name: 'Creatura',
          classId: spawn.npcKind === 'wisp' ? 'mage' : spawn.npcKind === 'sentinel' ? 'paladin' : 'warrior',
          radius: spawn.npcKind === 'sentinel' ? 18 : 13, hp: 65, maxHp: 65,
        });
      }
    }
    return previews;
  }
}

/** A bounded, local map of known procedural terrain. No map images or world-sized cache. */
export function drawMinimap(canvas: HTMLCanvasElement, world: World, self: Actor | null, actors: Actor[], pickups: Pickup[] = []): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect(), dpr = renderDpr(window.devicePixelRatio, rect.width, rect.height);
  const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const scale = Math.min(width, height) / 1600;
  const center = self ?? { x: 0, y: 0 };
  const left = center.x - width / (2 * scale), top = center.y - height / (2 * scale);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#525f46'; ctx.fillRect(0, 0, width, height);
  for (let ty = Math.floor(top / TILE_SIZE); ty <= Math.ceil((top + height / scale) / TILE_SIZE); ty++) {
    for (let tx = Math.floor(left / TILE_SIZE); tx <= Math.ceil((left + width / scale) / TILE_SIZE); tx++) {
      const tile = world.getTile(tx, ty);
      const dungeon = world.mode === 'world' ? dungeonAtTile(tx, ty) : undefined;
      ctx.fillStyle = dungeon && tile === 'rock' ? dungeon.theme.wallTop
        : dungeon && tile === dungeon.layout.floor ? dungeon.theme.floor
        : mapTerrainColor(tile, world.getMoisture((tx + .5) * TILE_SIZE, (ty + .5) * TILE_SIZE), noise(tx, ty));
      ctx.fillRect((tx * TILE_SIZE - left) * scale, (ty * TILE_SIZE - top) * scale, TILE_SIZE * scale + 0.5, TILE_SIZE * scale + 0.5);
    }
  }
  ctx.strokeStyle = 'rgba(235,227,192,0.1)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
  for (const pickup of pickups) {
    ctx.fillStyle = PICKUP_COLORS[pickup.kind];
    ctx.fillRect((pickup.x - left) * scale - 1, (pickup.y - top) * scale - 1, 2, 2);
  }
  if (world.mode === 'world') {
    for (const dungeon of DUNGEON_DEFINITIONS) {
      const dx = Math.max(10, Math.min(width - 10, (dungeon.area.x - left) * scale));
      const dy = Math.max(10, Math.min(height - 10, (dungeon.area.y - top) * scale));
      ctx.save(); ctx.translate(dx, dy); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = dungeon.theme.minimap; ctx.strokeStyle = '#423f32'; ctx.lineWidth = 1.5;
      ctx.fillRect(-5, -5, 10, 10); ctx.strokeRect(-5, -5, 10, 10); ctx.restore();
    }
    ctx.fillStyle = '#b6d9b018'; ctx.strokeStyle = '#b6d9b0'; ctx.lineWidth = 1;
    circle(ctx, -left * scale, -top * scale, OUTPOST.radius * scale); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#a5d9e8'; ctx.lineWidth = 2;
    circle(ctx, (ARENA_GATE.x - left) * scale, (ARENA_GATE.y - top) * scale, ARENA_GATE.radius * scale); ctx.stroke();
  }
  for (const actor of actors) {
    if (actor.id === self?.id || actor.hp <= 0) continue;
    ctx.fillStyle = actor.kind === 'npc' ? '#ccbb8d' : actor.teamId && actor.teamId === self?.teamId ? '#a6dcb4' : '#e6a08c';
    circle(ctx, (actor.x - left) * scale, (actor.y - top) * scale, actor.kind === 'npc' ? 1.6 : 2.5); ctx.fill();
  }
  const originX = -left * scale, originY = -top * scale;
  ctx.strokeStyle = 'rgba(242,229,181,0.7)'; ctx.lineWidth = 1;
  circle(ctx, originX, originY, 4); ctx.stroke();
  if (self) {
    ctx.save(); ctx.translate(width / 2, height / 2); ctx.rotate(self.aim);
    polygon(ctx, [6, 0, -4, -3.5, -2, 0, -4, 3.5]);
    ctx.fillStyle = '#fbefd2'; ctx.fill(); ctx.strokeStyle = '#384537'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
  }
}
