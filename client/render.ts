import { CHUNK_SIZE, CLASSES, PLAYER_RADIUS, TILE_SIZE, WORLD_SEED } from '../shared/config';
import type { Actor, ClassId, GameEvent, Pickup, Projectile, TileKind, Vec2 } from '../shared/types';
import { World } from '../shared/world';

export interface RenderFrame {
  time: number;
  self: Actor | null;
  actors: Actor[];
  projectiles: Projectile[];
  pickups: Pickup[];
  events: GameEvent[];
  selectedId: string | null;
  previewClass: ClassId;
  playing: boolean;
}

const TAU = Math.PI * 2;
const PICKUP_COLORS: Record<Pickup['kind'], string> = {
  heal: '#b6e5aa', haste: '#a5dbe2', power: '#e5cc81', weakness: '#bb99cb',
};
const TERRAIN: Record<TileKind, string> = {
  grass: '#737d57', path: '#a59970', water: '#465f63', rock: '#68716a', bush: '#546846', mud: '#77725b',
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

/** All artwork is deliberately procedural geometry. Assets can replace these passes independently. */
export class Renderer {
  world = new World(WORLD_SEED);
  readonly camera: Vec2 = { x: 0, y: 0 };
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private zoom = 1;
  private lastTime = 0;
  private wasPlaying = false;
  private hasCamera = false;
  private bounds = { left: 0, top: 0, right: 0, bottom: 0 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D non disponibile in questo browser.');
    this.ctx = ctx;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setSeed(seed: number): void {
    this.world = new World(seed);
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.width / 2) / this.zoom + this.camera.x,
      y: (clientY - rect.top - this.height / 2) / this.zoom + this.camera.y,
    };
  }

  destroy(): void { this.resizeObserver.disconnect(); }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.zoom = this.width < 680 ? 0.8 : 0.95;
  }

  render(frame: RenderFrame): void {
    const ctx = this.ctx;
    const now = performance.now();
    const delta = this.lastTime ? Math.max(0, Math.min(80, now - this.lastTime)) : 16;
    this.lastTime = now;
    const target = frame.self && frame.playing ? frame.self : {
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
    const bushes = this.drawTerrain(frame.time);
    this.drawCrossroads();
    const events = frame.events.filter(event => frame.time >= event.at && frame.time - event.at < event.duration);
    for (const event of events) this.drawGroundEvent(event, frame.time);
    const pickups = frame.playing ? frame.pickups : [
      ...this.world.getChunk(0, 0).pickups, ...this.world.getChunk(-1, 0).pickups,
    ];
    for (const pickup of pickups) if (this.visible(pickup)) this.drawPickup(pickup, frame.time);
    const actors = frame.playing ? [...frame.actors] : this.previewActors(frame.previewClass, frame.time);
    if (frame.self && frame.playing) {
      const index = actors.findIndex(actor => actor.id === frame.self!.id);
      if (index >= 0) actors[index] = frame.self;
      else actors.push(frame.self);
    }
    actors.sort((a, b) => a.y - b.y);
    for (const actor of actors) {
      if (!this.visible(actor)) continue;
      const self = actor.id === frame.self?.id || (!frame.playing && actor.id === 'preview');
      const allied = !!frame.self?.teamId && actor.teamId === frame.self.teamId;
      this.drawActor(actor, frame.time, self, allied, actor.id === frame.selectedId, events);
    }
    for (const projectile of frame.projectiles) if (this.visible(projectile)) this.drawProjectile(projectile, frame.time);
    for (const bush of bushes) this.drawBushTop(bush.x, bush.y, frame.time);
    for (const event of events) this.drawFloatingEvent(event, frame.time);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const vignette = ctx.createRadialGradient(this.width / 2, this.height / 2, this.width * 0.2, this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.68);
    vignette.addColorStop(0, 'rgba(19,29,24,0)');
    vignette.addColorStop(1, 'rgba(19,29,24,0.18)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private visible(point: Vec2): boolean {
    return point.x >= this.bounds.left && point.x <= this.bounds.right && point.y >= this.bounds.top && point.y <= this.bounds.bottom;
  }

  private drawTerrain(time: number): Vec2[] {
    const { ctx } = this;
    const bushes: Vec2[] = [];
    // Cache just the visible chunks; sampling terrain then avoids regenerating tile noise every frame.
    for (let cy = Math.floor(this.bounds.top / CHUNK_SIZE); cy <= Math.floor(this.bounds.bottom / CHUNK_SIZE); cy++) {
      for (let cx = Math.floor(this.bounds.left / CHUNK_SIZE); cx <= Math.floor(this.bounds.right / CHUNK_SIZE); cx++) {
        this.world.getChunk(cx, cy);
      }
    }
    for (let ty = Math.floor(this.bounds.top / TILE_SIZE); ty <= Math.floor(this.bounds.bottom / TILE_SIZE); ty++) {
      for (let tx = Math.floor(this.bounds.left / TILE_SIZE); tx <= Math.floor(this.bounds.right / TILE_SIZE); tx++) {
        const tile = this.world.getTile(tx, ty);
        const x = tx * TILE_SIZE, y = ty * TILE_SIZE;
        const variation = noise(tx, ty);
        const biome = this.world.getBiome(x + TILE_SIZE / 2, y + TILE_SIZE / 2);
        ctx.fillStyle = tile === 'grass'
          ? (biome === 'forest' ? '#677654' : biome === 'marsh' ? '#727861' : TERRAIN.grass)
          : TERRAIN[tile];
        ctx.fillRect(x, y, TILE_SIZE + 0.4, TILE_SIZE + 0.4);
        ctx.fillStyle = variation > 0.5 ? `rgba(226,219,159,${(variation - 0.5) * 0.055})` : `rgba(23,43,28,${variation * 0.09})`;
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        if (tile === 'water') {
          this.drawWater(tx, ty, x, y, time);
        } else if (tile === 'rock') {
          this.drawRock(x, y, variation);
        } else if (tile === 'bush') {
          bushes.push({ x, y });
          this.drawBushBase(x, y);
        } else if (tile === 'grass') {
          ctx.strokeStyle = 'rgba(47,65,40,0.24)';
          ctx.lineWidth = 1;
          for (let i = 0; i < 3; i++) {
            const px = x + 7 + noise(tx, ty, i + 1) * 33;
            const py = y + 8 + noise(tx, ty, i + 5) * 31;
            ctx.beginPath();
            ctx.moveTo(px - 2, py - 3);
            ctx.lineTo(px, py);
            ctx.lineTo(px + 2, py - 4);
            ctx.stroke();
          }
          if (variation > 0.975) {
            ctx.fillStyle = '#b8af77';
            ctx.fillRect(x + 17, y + 24, 2, 2);
            ctx.fillRect(x + 22, y + 27, 2, 2);
          }
        } else if (tile === 'path') {
          ctx.fillStyle = 'rgba(72,65,42,0.18)';
          ctx.fillRect(x + 8 + variation * 25, y + 9, 3, 2);
          ctx.fillRect(x + 34 - variation * 15, y + 31, 2, 1);
        } else if (tile === 'mud') {
          ctx.strokeStyle = 'rgba(47,48,37,0.22)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(x + 23, y + 24, 13 + variation * 6, 4, -0.2, 0, TAU);
          ctx.stroke();
        }
      }
    }
    return bushes;
  }

  private drawWater(tx: number, ty: number, x: number, y: number, time: number): void {
    const { ctx } = this;
    const edges: [number, number, number, number, number, number][] = [
      [0, -1, x, y + 1, x + TILE_SIZE, y + 1],
      [0, 1, x, y + TILE_SIZE - 1, x + TILE_SIZE, y + TILE_SIZE - 1],
      [-1, 0, x + 1, y, x + 1, y + TILE_SIZE],
      [1, 0, x + TILE_SIZE - 1, y, x + TILE_SIZE - 1, y + TILE_SIZE],
    ];
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#829389';
    for (const [dx, dy, x1, y1, x2, y2] of edges) {
      if (this.world.getTile(tx + dx, ty + dy) === 'water') continue;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(173,198,190,0.16)';
    ctx.lineWidth = 1;
    const sway = Math.sin(time * 0.0012 + tx * 2 + ty) * 3;
    ctx.beginPath();
    ctx.moveTo(x + 9 + sway, y + 17); ctx.lineTo(x + 21 + sway, y + 17);
    ctx.moveTo(x + 27 - sway, y + 34); ctx.lineTo(x + 37 - sway, y + 34);
    ctx.stroke();
  }

  private drawRock(x: number, y: number, variation: number): void {
    const { ctx } = this;
    ctx.fillStyle = '#50594f';
    ctx.fillRect(x + 1, y + 6, TILE_SIZE - 2, TILE_SIZE - 6);
    polygon(ctx, [x + 2, y + 9, x + 12, y + 2, x + 37, y + 3, x + 46, y + 12, x + 45, y + 37, x + 34, y + 43, x + 8, y + 41, x + 2, y + 31]);
    ctx.fillStyle = variation > 0.5 ? '#8a9080' : '#828b7b';
    ctx.fill();
    ctx.strokeStyle = 'rgba(32,43,34,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    polygon(ctx, [x + 12, y + 3, x + 37, y + 4, x + 44, y + 13, x + 29, y + 20, x + 11, y + 14]);
    ctx.fillStyle = 'rgba(214,218,189,0.17)'; ctx.fill();
    ctx.strokeStyle = 'rgba(51,61,47,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 29, y + 20); ctx.lineTo(x + 34, y + 32); ctx.lineTo(x + 27, y + 41); ctx.stroke();
    ctx.fillStyle = '#6e805c';
    ctx.fillRect(x + 5, y + 33, 10, 5);
  }

  private drawBushBase(x: number, y: number): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(26,45,31,0.21)';
    ctx.beginPath(); ctx.ellipse(x + 24, y + 28, 23, 18, 0, 0, TAU); ctx.fill();
    for (let i = 0; i < 5; i++) {
      const px = x + 8 + (i % 3) * 15, py = y + 12 + Math.floor(i / 3) * 18;
      circle(ctx, px, py, 12);
      ctx.fillStyle = i % 2 ? '#60794e' : '#5a704a'; ctx.fill();
      ctx.strokeStyle = 'rgba(37,56,32,0.22)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  private drawBushTop(x: number, y: number, time: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 0.27;
    ctx.strokeStyle = '#b2bd86'; ctx.lineWidth = 2;
    const sway = Math.sin(time * 0.001 + x * 0.01) * 1.3;
    for (let i = 0; i < 4; i++) {
      const px = x + 8 + i * 10, py = y + 19 + (i % 2) * 11;
      ctx.beginPath(); ctx.moveTo(px - 3 + sway, py - 3); ctx.lineTo(px, py); ctx.lineTo(px + 4 + sway, py - 4); ctx.stroke();
    }
    ctx.restore();
  }

  private drawCrossroads(): void {
    if (!this.visible({ x: 0, y: 0 })) return;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(231,222,170,0.2)'; ctx.lineWidth = 2;
    circle(ctx, 0, 0, 92); ctx.stroke();
    ctx.setLineDash([3, 12]); circle(ctx, 0, 0, 81); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(53,61,41,0.19)'; ctx.lineWidth = 1;
    polygon(ctx, [0, -38, 25, 0, 0, 38, -25, 0]); ctx.stroke();
    circle(ctx, 0, 0, 15); ctx.stroke();
    ctx.font = '500 9px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(246,237,192,0.4)';
    ctx.fillText('I L   C R O C E V I A', 0, 118);
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

  private drawActor(actor: Actor, time: number, self: boolean, allied: boolean, selected: boolean, events: GameEvent[]): void {
    const { ctx } = this;
    const dead = actor.hp <= 0;
    const color = dead ? '#91968a' : CLASSES[actor.classId].color;
    const r = actor.radius || PLAYER_RADIUS;
    ctx.save(); ctx.translate(actor.x, actor.y);
    if (actor.hidden) ctx.globalAlpha = self || allied ? 0.58 : 0.32;
    if (dead) ctx.globalAlpha = 0.45;
    ctx.fillStyle = 'rgba(22,32,23,0.28)';
    ctx.beginPath(); ctx.ellipse(1, 7, r + 4, r * 0.56, 0, 0, TAU); ctx.fill();
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
    else this.drawPlayer(actor, color, dead);
    if (!dead && events.some(event => event.kind === 'hit' && event.targetId === actor.id && time - event.at < 130)) {
      circle(ctx, 0, 0, r + 2); ctx.fillStyle = 'rgba(255,241,221,0.48)'; ctx.fill();
    }
    if (self && !dead) {
      ctx.save(); ctx.rotate(actor.aim);
      polygon(ctx, [r + 15, -3, r + 20, 0, r + 15, 3]);
      ctx.fillStyle = '#f2eacb'; ctx.fill(); ctx.restore();
    }
    if (actor.kind === 'player' || selected || actor.hp < actor.maxHp) {
      const barWidth = actor.kind === 'player' ? 42 : 32;
      const barY = -r - 11;
      ctx.fillStyle = 'rgba(24,32,24,0.75)'; ctx.fillRect(-barWidth / 2 - 1, barY - 1, barWidth + 2, 5);
      ctx.fillStyle = self || allied ? '#c7d59d' : actor.kind === 'npc' ? '#dab07f' : '#d49381';
      ctx.fillRect(-barWidth / 2, barY, barWidth * Math.max(0, Math.min(1, actor.hp / actor.maxHp)), 3);
      if (actor.kind === 'player') {
        ctx.textAlign = 'center'; ctx.font = `${self ? '600' : '500'} 10px Inter, system-ui, sans-serif`;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(34,43,29,0.65)';
        const label = `${actor.name.slice(0, 20)}${self ? ' · tu' : ''}`;
        ctx.strokeText(label, 0, barY - 7); ctx.fillStyle = self ? '#faf2d8' : allied ? '#ceebd6' : '#e7e6d7'; ctx.fillText(label, 0, barY - 7);
      } else if (selected) {
        ctx.textAlign = 'center'; ctx.font = '500 9px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#f0e8cf'; ctx.fillText(`${actor.name} · ${actor.level}`, 0, barY - 6);
      }
    }
    if (actor.hidden && self) {
      ctx.globalAlpha = 1; ctx.font = '500 9px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#e0e8be'; ctx.fillText('NASCOSTO', 0, r + 29);
    }
    ctx.restore();
  }

  private drawPlayer(actor: Actor, color: string, dead: boolean): void {
    const { ctx } = this;
    const r = actor.radius;
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
    } else {
      polygon(ctx, [-8, -8, 8, -8, 8, 2, 4, 8, 0, 11, -4, 8, -8, 2]); ctx.fill();
      ctx.strokeStyle = '#74643d'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 6); ctx.moveTo(-4, -1); ctx.lineTo(4, -1); ctx.stroke();
      ctx.save(); ctx.rotate(actor.aim); ctx.strokeStyle = '#d9c38e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(24, 10); ctx.stroke();
      ctx.fillStyle = '#eaddb3'; ctx.fillRect(20, 4, 8, 12); ctx.restore();
    }
  }

  private drawNpc(actor: Actor, time: number, color: string): void {
    const { ctx } = this;
    const r = actor.radius;
    ctx.strokeStyle = '#3c483b'; ctx.lineWidth = 1.8;
    if (actor.npcKind === 'wisp') {
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
  const width = canvas.width, height = canvas.height;
  const scale = Math.min(width, height) / 1600;
  const center = self ?? { x: 0, y: 0 };
  const left = center.x - width / (2 * scale), top = center.y - height / (2 * scale);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#525f46'; ctx.fillRect(0, 0, width, height);
  for (let ty = Math.floor(top / TILE_SIZE); ty <= Math.ceil((top + height / scale) / TILE_SIZE); ty++) {
    for (let tx = Math.floor(left / TILE_SIZE); tx <= Math.ceil((left + width / scale) / TILE_SIZE); tx++) {
      const tile = world.getTile(tx, ty);
      if (tile === 'grass') continue;
      ctx.fillStyle = tile === 'rock' ? '#969a84' : TERRAIN[tile];
      ctx.fillRect((tx * TILE_SIZE - left) * scale, (ty * TILE_SIZE - top) * scale, TILE_SIZE * scale + 0.5, TILE_SIZE * scale + 0.5);
    }
  }
  ctx.strokeStyle = 'rgba(235,227,192,0.1)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
  for (const pickup of pickups) {
    ctx.fillStyle = PICKUP_COLORS[pickup.kind];
    ctx.fillRect((pickup.x - left) * scale - 1, (pickup.y - top) * scale - 1, 2, 2);
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
