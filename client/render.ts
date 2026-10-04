import { PICKUP_COLORS, circle, noise, polygon } from './render-primitives';
import { CHUNK_SIZE, CLASSES, PLAYER_RADIUS, TILE_SIZE, WORLD_SEED } from '../shared/config';
import { equippedAbility } from '../shared/progression';
import type { Actor, ClassId, GameEvent, Pickup, Projectile, Trap, Vec2, RoomMode, MatchResult } from '../shared/types';
import { drawTransitionOverlay, matchResultText, MATCH_RESULT_DURATION_MS } from './transition-overlay';
import { World } from '../shared/world';
import { ARENA_GATE } from '../shared/arena';
import { WorldAssetArt } from './world-asset-art';
import { drawItemArt } from './item-art';
import { shapeBounds } from '../shared/world-authoring';
import { activeAssetFades } from './asset-visibility';
import { clipAssetCells } from './asset-cell-regions';
import type { ArenaGateState } from '../shared/types';
import { DUNGEON_BY_BOSS_ID, DUNGEON_DEFINITIONS, dungeonEncounters, dungeonApproachNormal, dungeonApproachPoint, dungeonFlames, inwardFlameAngle } from '../shared/dungeons';
import type { DungeonDefinition } from '../shared/dungeons';
import { DUNGEON_ENTRY_MS, DUNGEON_ARRIVAL_MS, type BossLockState } from '../shared/bosses';
import { renderDpr } from './frame-budget';
import { TERRAIN } from './terrain-style';
import { arenaViewSign, cameraZoom, parseCameraSettings, viewVector, type CameraSettings } from './camera-settings';

import { TerrainRenderer } from './terrain-renderer';
import { ActorRenderer } from './actor-renderer';
import type { RenderFrame } from './render-types';
export type { RenderFrame } from './render-types';
const TAU = Math.PI * 2;
export class Renderer {
  private matchResult: { result: MatchResult; elapsed: number } | null = null;
  showMatchResult(result: MatchResult): void { this.matchResult = { result, elapsed: 0 }; }
  clearMatchResult(): void { this.matchResult = null; }
  private readonly terrain: TerrainRenderer;
  private readonly characters: ActorRenderer;
  world = new World(WORLD_SEED);
  readonly camera: Vec2 = { x: 0, y: 0 };
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly touchQuery = matchMedia('(pointer: coarse)');
  private width = 1;
  private height = 1;
  private dpr = 1;
  private zoom = 1;
  private cameraSettings = parseCameraSettings(null);
  private viewSign = 1;
  get orientation(): number { return this.viewSign; }
  setCameraSettings(settings: CameraSettings): void { this.cameraSettings = settings; this.resize(); }
  private lastTime = 0;
  private wasPlaying = false;
  private hasCamera = false;
  private bounds = { left: 0, top: 0, right: 0, bottom: 0 };

  private readonly worldAssetArt = new WorldAssetArt();

  readonly spritesReady: Promise<void>;

  private readonly restoreContext = (): void => { this.terrain.invalidate(); };

  weather: 'clear' | 'rain' | 'snow' = 'rain';
  private lastWeatherCheck = 0;
  constructor(private readonly canvas: HTMLCanvasElement, private readonly localDungeons?: readonly DungeonDefinition[]) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D non disponibile in questo browser.');
    this.ctx = ctx;
    canvas.addEventListener('contextrestored', this.restoreContext);
    this.terrain = new TerrainRenderer(ctx, localDungeons);
    this.characters = new ActorRenderer(ctx, this.touchQuery);
    this.spritesReady = Promise.all([this.terrain.spritesReady, this.characters.spritesReady]).then(() => {});
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setSeed(seed: number, mode: RoomMode = 'world'): void {
    this.world = new World(seed, 160, mode);
    this.terrain.invalidate();
    this.hasCamera = false;
    this.viewSign = 1;
    this.characters.reset();
    this.resize();
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    const offset = viewVector({ x: (clientX - rect.left - this.width / 2) / this.zoom,
      y: (clientY - rect.top - this.height / 2) / this.zoom }, this.viewSign);
    return {
      x: offset.x + this.camera.x,
      y: offset.y + this.camera.y,
    };
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('contextrestored', this.restoreContext);
    this.terrain.invalidate();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = renderDpr(window.devicePixelRatio, Math.max(1, rect.width), Math.max(1, rect.height));
    const unchanged = this.width === Math.max(1, rect.width) && this.height === Math.max(1, rect.height) && this.dpr === dpr;
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = dpr;
    if (!unchanged) {
      this.terrain.invalidate();
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
    }
    this.zoom = cameraZoom(this.width, this.height, this.touchQuery.matches, this.cameraSettings);
  }

  render(frame: RenderFrame): void {
    const ctx = this.ctx;
    const now = performance.now();
    const delta = this.lastTime ? Math.max(0, Math.min(80, now - this.lastTime)) : 16;
    this.lastTime = now;
    if (this.dpr !== renderDpr(window.devicePixelRatio, this.width, this.height)) this.resize();

    this.viewSign = arenaViewSign(this.world.mode, frame.playing ? frame.self?.teamId : null);
    const target = frame.self && frame.playing
        ? frame.self
        : {
            x: this.world.authoring.document.spawn.x * TILE_SIZE + 25 + Math.sin(frame.time * 0.000025) * 18,
            y: this.world.authoring.document.spawn.y * TILE_SIZE + 12 + Math.cos(frame.time * 0.000019) * 12,
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
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.shadowBlur = 0;
    ctx.fillStyle = TERRAIN.grass;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.zoom, this.zoom * this.viewSign);
    ctx.translate(-this.camera.x, -this.camera.y);

    this.terrain.drawCachedTerrain(this.world, { camera: this.camera, width: this.width, height: this.height, dpr: this.dpr, zoom: this.zoom }, frame.time);
    this.drawDungeonEntry(frame, false);

    if (this.world.mode === 'world') {
      if (!this.localDungeons) {
        this.drawWorldZones(frame.time, frame.arenaGate, frame.self);
      }
      this.drawDungeons();
    }
    const worldAssets = this.localDungeons ? [] : this.world.assetsIn({ left: this.bounds.left / TILE_SIZE, top: this.bounds.top / TILE_SIZE,
      right: this.bounds.right / TILE_SIZE, bottom: this.bounds.bottom / TILE_SIZE });
    const groundAssets = worldAssets.filter(p => this.world.authoring.assets.get(p.assetId)!.layer === 'ground');
    const objectAssets = worldAssets.filter(p => this.world.authoring.assets.get(p.assetId)!.layer === 'object')
      .sort((a, b) => (a.y + this.world.authoring.assets.get(a.assetId)!.height * this.world.authoring.assets.get(a.assetId)!.pivot.y)
        - (b.y + this.world.authoring.assets.get(b.assetId)!.height * this.world.authoring.assets.get(b.assetId)!.pivot.y) || a.id.localeCompare(b.id));
    const publicPlayers = [...frame.actors.filter(actor => actor.id !== frame.self?.id), ...(frame.self ? [frame.self] : [])]
      .filter(actor => actor.kind === 'player' && actor.hp > 0 && this.world.pvpAt(actor.x, actor.y));
    const assetFades = new Map(worldAssets.map(p => {
      const a = this.world.authoring.assets.get(p.assetId)!;
      const active = activeAssetFades(this.world, p, frame.self, publicPlayers);
      return [p.id, {
        traversable: this.worldAssetArt.fadeAmount(a, p, active.traversable, frame.time, 'traversable'),
        hiding: this.worldAssetArt.fadeAmount(a, p, active.hiding, frame.time, 'hiding'),
        annotated: a.cells.some(cell => cell.visibility !== 'normal'),
      }] as const;
    }));
    const paintObject = (p: typeof objectAssets[number], overhead = false) => {
      const a = this.world.authoring.assets.get(p.assetId)!, fade = assetFades.get(p.id)!;
      if (overhead && !fade.annotated) return;
      ctx.save();
      if (fade.annotated) {
        clipAssetCells(ctx, a, p, TILE_SIZE, cell => (cell.visibility !== 'normal') === overhead);
      }
      this.worldAssetArt.draw(ctx, a, p, 1, TILE_SIZE, frame.time, fade.traversable, fade.hiding);
      ctx.restore();
    };
    for (const p of groundAssets) paintObject(p);
    let objectIndex = 0;

    for (const w of frame.bossWindups ?? []) {
      const progress = Math.max(0, Math.min(1, (frame.time - w.startedAt) / Math.max(1, w.resolvesAt - w.startedAt)));
      ctx.save();
      ctx.fillStyle = 'rgba(216,72,45,0.2)';
      ctx.strokeStyle = '#ffb184';
      ctx.lineWidth = 3;
      if (w.kind === 'charge' && w.targetX !== undefined && w.targetY !== undefined) {
        const angle = Math.atan2(w.targetY - w.y, w.targetX - w.x);
        const length = Math.hypot(w.targetX - w.x, w.targetY - w.y);
        ctx.translate(w.x, w.y);
        ctx.rotate(angle);
        ctx.fillRect(0, -w.radius, length, w.radius * 2);
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(0, -w.radius);
        ctx.lineTo(length, -w.radius);
        ctx.moveTo(0, w.radius);
        ctx.lineTo(length, w.radius);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(255,177,132,${0.25 + progress * 0.5})`;
        ctx.fillRect(length * progress - 4, -w.radius, 8, w.radius * 2);
      } else if (w.kind === 'nova') {
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.radius, 0, TAU);
        ctx.arc(w.x, w.y, w.innerRadius ?? 0, 0, TAU, true);
        ctx.fill('evenodd');
        ctx.stroke();
        circle(ctx, w.x, w.y, (w.innerRadius ?? 0) + (w.radius - (w.innerRadius ?? 0)) * progress);
        ctx.stroke();
      } else {
        circle(ctx, w.x, w.y, w.radius);
        ctx.fill();
        ctx.stroke();
        circle(ctx, w.x, w.y, w.radius * progress);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const gold of frame.goldDrops ?? []) {
      if (this.visible(gold)) {
        ctx.save();
        ctx.translate(gold.x, gold.y);
        ctx.fillStyle = 'rgba(241,197,85,0.15)';
        circle(ctx, 0, 0, 23);
        ctx.fill();
        ctx.fillStyle = '#edc463';
        ctx.strokeStyle = '#7d572c';
        ctx.lineWidth = 2;
        for (const [x, y] of [[-7, 4], [6, 3], [0, -5]]) {
          circle(ctx, x, y, 7);
          ctx.fill();
          ctx.stroke();
        }
        ctx.font = '600 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff0c5';
        ctx.fillText(`${gold.amount} gold`, 0, -23);
        ctx.restore();
      }
    }

    const events = frame.events.filter(event => frame.time >= event.at && frame.time - event.at < event.duration);
    const previewAbility = frame.self && frame.aimPreview ? equippedAbility(frame.self, frame.aimPreview.slot) : undefined;
    if (frame.self && frame.self.hp > 0 && frame.aimPreview != null && previewAbility) {
      const ability = previewAbility;
      ctx.save();
      ctx.translate(frame.self.x, frame.self.y);
      ctx.rotate(frame.aimPreview.angle);
      ctx.strokeStyle = '#fff1c470';
      ctx.fillStyle = '#fff1c40c';
      ctx.lineWidth = 1 / this.zoom;
      if (ability.kind === 'melee') {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, ability.range, -0.65, 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (ability.kind === 'trap') {
        circle(ctx, Math.min(ability.range || 60, 60), 0, ability.radius);
        ctx.stroke();
      } else {
        ctx.setLineDash([5, 9]);
        ctx.beginPath();
        ctx.moveTo(18, 0);
        ctx.lineTo(ability.range, 0);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(ability.range - 7, -4);
        ctx.lineTo(ability.range, 0);
        ctx.lineTo(ability.range - 7, 4);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const event of events) this.drawGroundEvent(event, frame.time);

    const pickups = frame.playing ? frame.pickups : [
      ...this.world.getChunk(0, 0).pickups,
      ...this.world.getChunk(-1, 0).pickups,
    ];
    for (const pickup of pickups) if (this.visible(pickup)) this.drawPickup(pickup, frame.time);
    for (const item of frame.groundItems ?? []) if (this.visible(item) && item.expiresAt > frame.time) {
      ctx.save(); ctx.translate(item.x - 11, item.y - 11 + Math.sin(frame.time * .003 + item.x) * 1.5);
      ctx.globalAlpha = Math.min(1, (item.expiresAt - frame.time) / 1000); drawItemArt(ctx, item.stack.itemId, 22, frame.time);
      if (item.stack.quantity > 1) { ctx.font = 'bold 9px system-ui'; ctx.fillStyle = '#f5e7b3'; ctx.fillText(String(item.stack.quantity), 15, 24); }
      ctx.restore();
    }

    if (frame.traps) {
      for (const trap of frame.traps) if (this.visible(trap)) this.drawTrap(trap, frame.time);
    }

    const actors = frame.playing ? frame.actors.filter(actor => this.visible(actor)) : this.previewActors(frame.previewClass, frame.time);
    if (frame.self && frame.playing) {
      const index = actors.findIndex(actor => actor.id === frame.self!.id);
      if (index >= 0) actors[index] = frame.self;
      else actors.push(frame.self);
    }
    const liveMotion = new Set(actors.map(actor => actor.id));
    this.characters.retainMotion(liveMotion);

    const hitTargets = new Set<string>();
    for (const event of events) if (event.kind === 'hit' && event.targetId && frame.time - event.at < 130) hitTargets.add(event.targetId);

    actors.sort((a, b) => (a.y - b.y) * this.viewSign);
    for (const actor of actors) {
      if (!this.visible(actor)) continue;
      while (objectIndex < objectAssets.length) {
        const p = objectAssets[objectIndex], a = this.world.authoring.assets.get(p.assetId)!;
        if ((p.y + a.height * a.pivot.y) * TILE_SIZE > actor.y) break;
        paintObject(p); objectIndex++;
      }
      const self = actor.id === frame.self?.id || (!frame.playing && actor.id === 'preview');
      const allied = !!frame.self?.teamId && actor.teamId === frame.self.teamId;

      // TROVA IL WINDUP (ATTACCO IN CORSO)
      const activeWindup = actor.npcKind === 'boss'
        ? frame.bossWindups?.find(w => w.bossId === actor.id)
        : undefined;

      this.characters.drawActor(
        actor,
        frame.time,
        self,
        allied,
        actor.id === frame.selectedId,
        hitTargets,
        self ? frame.moveDirection : undefined,
        activeWindup,
        actors.length <= 200 || self || allied || actor.id === frame.selectedId || actor.npcKind === 'boss',
        this.viewSign
      );
    }
    while (objectIndex < objectAssets.length) paintObject(objectAssets[objectIndex++]);
    // Explicitly annotated cells cover actors on both layers; unannotated cells keep their original depth.
    for (const p of worldAssets) if (assetFades.get(p.id)!.annotated) paintObject(p, true);

    for (const projectile of frame.projectiles) if (this.visible(projectile)) this.drawProjectile(projectile, frame.time);
    if (this.world.mode === 'world') this.drawDungeonFlames(frame.time, frame.bossLocks);

    for (const event of events) this.drawFloatingEvent(event, frame.time);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (frame.time - this.lastWeatherCheck > 1000) {
      this.lastWeatherCheck = frame.time;
      const px = frame.self?.x ?? this.camera.x, py = frame.self?.y ?? this.camera.y;
      const isStorm = this.world.mode === 'world' && (frame.time % 600_000) < 180_000;
      const temp = this.world.getTemperature(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
      this.weather = !isStorm ? 'clear' : (temp < 0.28 ? 'snow' : 'rain');
    }

    if (this.weather === 'snow') {
      this.drawSnow(frame.time);
    } else if (this.weather === 'rain') {
      this.drawRain(frame.time);
    }

   // this.drawVignette();
    this.drawTeamIndicators(frame);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawDungeonEntry(frame, true);
    if (this.matchResult) {
      const elapsed = this.matchResult.elapsed += delta;
      if (elapsed >= MATCH_RESULT_DURATION_MS) this.matchResult = null;
      else {
        const opacity = Math.min(1, elapsed / 250, (MATCH_RESULT_DURATION_MS - elapsed) / 700);
        drawTransitionOverlay(ctx, this.width, this.height, { ...matchResultText(this.matchResult.result), opacity, veil: opacity * .82, position: .42 });
      }
    }
  }

  private drawDungeonEntry(frame: RenderFrame, overlay: boolean): void {
    if (!frame.playing || !frame.self || frame.self.hp <= 0 || this.world.mode !== 'world') return;
    const preparation = frame.bossPreparations?.[0];
    const lock = frame.bossLocks?.find(lock => lock.locked && lock.relation === 'participant' && lock.startedAt !== undefined
      && frame.time >= lock.startedAt && frame.time - lock.startedAt < 2600);
    if (!preparation && !lock) return;

    const remaining = preparation ? Math.max(0, preparation.endsAt - frame.time) : 0;
    const arrival = lock ? frame.time - lock.startedAt! : 0;
    const progress = preparation ? 1 - Math.min(1, remaining / DUNGEON_ENTRY_MS) : Math.min(1, arrival / DUNGEON_ARRIVAL_MS);
    const opacity = preparation ? 1 : Math.min(1, (2600 - arrival) / 600);
    const { ctx } = this;
    ctx.save();
    if (!overlay) {
      ctx.translate(frame.self.x, frame.self.y);
      ctx.globalAlpha = opacity * (preparation ? 0.75 : 1 - progress);
      ctx.strokeStyle = '#efcf87';
      ctx.fillStyle = '#efcf871c';
      ctx.lineWidth = 2;
      const radius = preparation ? 54 - progress * 18 : 36 + progress * 100;
      circle(ctx, 0, 0, radius);
      ctx.fill();
      ctx.stroke();
      circle(ctx, 0, 0, radius + 7);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const angle = (i * TAU) / 8 + frame.time * 0.001;
        ctx.save();
        ctx.rotate(angle);
        ctx.translate(radius + 14, 0);
        polygon(ctx, [-4, 0, 0, -7, 4, 0, 0, 7]);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    } else {
      const dungeon = this.localDungeons?.flatMap(dungeonEncounters).find(d => d.bossId === (preparation?.bossId ?? lock?.bossId))
        ?? DUNGEON_BY_BOSS_ID.get((preparation?.bossId ?? lock?.bossId)!);
      drawTransitionOverlay(ctx, this.width, this.height, {
        heading: preparation ? 'IL DUNGEON SI RISVEGLIA' : 'DUNGEON INIZIATO',
        title: dungeon?.name ?? preparation?.name ?? 'La sfida ha inizio',
        detail: preparation ? `Preparati · ${(remaining / 1000).toFixed(1)} s` : 'I passaggi della stanza sono chiusi',
        opacity, veil: preparation ? progress * .82 : .82 * Math.max(0, 1 - arrival / 550),
      });
    }
    ctx.restore();
  }

  private drawTrap(trap: Trap, time: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(trap.x, trap.y);

    ctx.strokeStyle = `${trap.color}44`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    circle(ctx, 0, 0, trap.radius);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#2f382a';
    circle(ctx, 0, 0, 16);
    ctx.fill();
    ctx.strokeStyle = trap.color;
    ctx.lineWidth = 2;
    circle(ctx, 0, 0, 16);
    ctx.stroke();

    ctx.fillStyle = '#b7cfad';
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const tx = Math.cos(angle) * 14;
      const ty = Math.sin(angle) * 14;
      polygon(ctx, [tx, ty, tx * 0.5 - ty * 0.2, ty * 0.5 + tx * 0.2, tx * 0.5 + ty * 0.2, ty * 0.5 - tx * 0.2]);
      ctx.fill();
    }

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
      const dy = (teammate.y - this.camera.y) * this.zoom * this.viewSign;
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

  private drawWorldZones(time: number, state?: ArenaGateState, self?: Actor | null): void {
    const ctx = this.ctx;
    const zones = this.world.authoring.zones.query({ left: this.bounds.left / TILE_SIZE, top: this.bounds.top / TILE_SIZE, right: this.bounds.right / TILE_SIZE, bottom: this.bounds.bottom / TILE_SIZE });
    for (const zone of zones) {
      if (!zone.arenaId) continue;
      const b = shapeBounds(zone.shape), center = { x: (b.left + b.right) * TILE_SIZE / 2, y: (b.top + b.bottom) * TILE_SIZE / 2 };
      const active = self && this.world.arenaAt(self.x, self.y) === zone.id ? state : undefined;
      ctx.save(); ctx.beginPath();
      if (zone.shape.kind === 'circle') circle(ctx, center.x, center.y, zone.shape.radius * TILE_SIZE);
      else ctx.rect(b.left * TILE_SIZE, b.top * TILE_SIZE, (b.right - b.left) * TILE_SIZE, (b.bottom - b.top) * TILE_SIZE);
      ctx.fillStyle = zone.arenaId ? '#89bcca20' : zone.pvp ? '#dc7a6510' : '#a6cd9910';
      ctx.strokeStyle = active?.phase === 'countdown' ? '#ffe3a0' : zone.arenaId ? '#a5d9e8' : zone.pvp ? '#dc7a65' : '#a6cd99';
      ctx.lineWidth = zone.arenaId ? 3 : 1; ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center'; ctx.font = '600 11px system-ui'; ctx.fillStyle = '#e9efd9';
      ctx.fillText(zone.name, center.x, b.bottom * TILE_SIZE + 18);
      if (zone.arenaId) {
        ctx.font = '700 28px system-ui'; ctx.fillText('⚔', center.x, center.y + 9);
        if (active?.startsAt && zone.shape.kind === 'circle') {
          const progress = Math.max(0, Math.min(1, 1 - (active.startsAt - time) / ARENA_GATE.countdownMs));
          ctx.beginPath();ctx.arc(center.x,center.y,zone.shape.radius*TILE_SIZE+7,-Math.PI/2,-Math.PI/2+progress*TAU);ctx.lineWidth=7;ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  private drawRain(time: number): void {
    const { ctx, width, height } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(18, 32, 44, 0.22)';
    ctx.fillRect(0, 0, width, height);

    const wind = 0.22;
    const dropCount = Math.round((width * height) / 9200);

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
        if (seed < 0.65) continue;

        const cycle = (time * 0.0028 + seed * 10) % 1;
        const worldX = gx * CELL + noise(gx, gy, 1) * CELL;
        const worldY = gy * CELL + noise(gx, gy, 2) * CELL;

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

  private drawSnow(time: number): void {
    const { ctx, width, height } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(215, 235, 250, 0.04)';
    ctx.fillRect(0, 0, width, height);

    const margin = 80;
    const boxW = width / this.zoom + margin * 2;
    const boxH = height / this.zoom + margin * 2;
    const flakeCount = Math.round((boxW * boxH) / 6000);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
    ctx.beginPath();

    for (let i = 0; i < flakeCount; i++) {
      const seed = i * 4919;
      const depth = i % 3;
      const fallSpeed = 0.035 + depth * 0.018;
      const radius = (1.0 + depth * 0.75) * Math.max(0.85, this.zoom);

      const seedX = Math.abs(Math.sin(seed) * 100000) % boxW;
      const seedY = Math.abs(Math.cos(seed) * 100000) % boxH;
      const sway = Math.sin(time * 0.0012 + seed) * 12;

      const worldFallY = time * fallSpeed;
      const worldDriftX = time * 0.008 + sway;

      const dx = ((seedX + worldDriftX - this.camera.x) % boxW + boxW * 1.5) % boxW - boxW / 2;
      const dy = ((seedY + worldFallY - this.camera.y) % boxH + boxH * 1.5) % boxH - boxH / 2;

      const screenX = dx * this.zoom + width / 2;
      const screenY = dy * this.zoom + height / 2;

      ctx.moveTo(screenX + radius, screenY);
      ctx.arc(screenX, screenY, radius, 0, TAU);
    }
    ctx.fill();
    ctx.restore();
  }

  private drawVignette(): void {
    const { ctx, width, height } = this;
    ctx.save();
    const maxDim = Math.max(width, height);
    const vignette = ctx.createRadialGradient(
      width / 2, height / 2, maxDim * 0.15,
      width / 2, height / 2, maxDim * 0.58
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.75, 'rgba(0, 0, 0, 0.45)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.75)');

    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  private drawDungeonFlames(time: number, locks: BossLockState[] = []): void {
    const { ctx } = this;
    const drawn = new Set<string>();
    for (const lock of locks) {
      if (!lock.locked) continue;
      const dungeon = this.localDungeons ? this.localDungeons.flatMap(dungeonEncounters).find(d => d.bossId === lock.bossId) : DUNGEON_BY_BOSS_ID.get(lock.bossId);
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
    for (const definition of this.localDungeons ?? DUNGEON_DEFINITIONS) this.drawDungeon(definition);
  }

  private drawDungeon(definition: DungeonDefinition): void {
    const { ctx } = this;
    ctx.save();
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

  private drawPickup(pickup: Pickup, time: number): void {
    const { ctx } = this;
    const bob = Math.sin(time * 0.0025 + pickup.x) * 2.5;
    ctx.save();
    ctx.translate(pickup.x, pickup.y);
    ctx.fillStyle = 'rgba(26,38,25,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 7, 11, 4, 0, 0, TAU);
    ctx.fill();

    const glow = ctx.createRadialGradient(0, bob, 2, 0, bob, 20);
    glow.addColorStop(0, `${PICKUP_COLORS[pickup.kind]}44`);
    glow.addColorStop(1, `${PICKUP_COLORS[pickup.kind]}00`);
    ctx.fillStyle = glow;
    circle(ctx, 0, bob, 20);
    ctx.fill();

    ctx.translate(0, bob);
    polygon(ctx, [0, -10, 8, 0, 0, 10, -8, 0]);
    ctx.fillStyle = '#394938';
    ctx.fill();
    ctx.strokeStyle = PICKUP_COLORS[pickup.kind];
    ctx.lineWidth = 1.5;
    ctx.stroke();

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
    ctx.stroke();
    ctx.restore();
  }

  private drawProjectile(projectile: Projectile, time: number): void {
    const { ctx } = this;
    const angle = Math.atan2(projectile.vy, projectile.vx);
    const r = projectile.radius;
    ctx.save();
    ctx.translate(projectile.x, projectile.y);
    ctx.rotate(angle);
    const trail = ctx.createLinearGradient(-r * 5, 0, r, 0);
    trail.addColorStop(0, `${projectile.color}00`);
    trail.addColorStop(1, `${projectile.color}aa`);
    ctx.fillStyle = trail;
    polygon(ctx, [-r * 5, 0, -r * 0.2, -r * 0.65, r, 0, -r * 0.2, r * 0.65]);
    ctx.fill();
    ctx.shadowColor = projectile.color;
    ctx.shadowBlur = 8;
    circle(ctx, 0, 0, r * (0.82 + Math.sin(time * 0.015) * 0.08));
    ctx.fillStyle = projectile.color;
    ctx.fill();
    ctx.shadowBlur = 0;
    circle(ctx, r * 0.18, -r * 0.12, r * 0.36);
    ctx.fillStyle = '#fff6df';
    ctx.fill();
    ctx.restore();
  }

  private drawGroundEvent(event: GameEvent, time: number): void {
    if (!this.visible(event) || event.kind === 'hit' || event.kind === 'pickup') return;
    const { ctx } = this;
    const progress = Math.max(0, Math.min(1, (time - event.at) / Math.max(1, event.duration)));
    const fade = 1 - progress;
    ctx.save();
    ctx.translate(event.x, event.y);
    ctx.globalAlpha = fade;
    ctx.strokeStyle = event.color;
    ctx.fillStyle = event.color;
    ctx.lineWidth = 2;
    const radius = Math.max(12, event.radius);

    if (event.abilityKind === 'melee') {
      const angle = event.aim ?? 0;
      ctx.globalAlpha = fade * 0.15;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, angle - 0.78, angle + 0.78);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = fade;
      ctx.lineWidth = 4 * fade + 1;
      ctx.beginPath();
      ctx.arc(0, 0, radius * (0.68 + progress * 0.3), angle - 0.78 + progress * 0.9, angle + 0.78 + progress * 0.25);
      ctx.stroke();
    } else if (event.abilityKind === 'dash') {
      ctx.rotate(event.aim ?? 0);
      ctx.globalAlpha = fade * 0.7;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-8, i * 10);
        ctx.lineTo(radius * (0.4 + progress * 0.6), i * 10);
        ctx.stroke();
      }
    } else if (event.abilityKind === 'projectile') {
      circle(ctx, 0, 0, 9 + progress * 17);
      ctx.stroke();
    } else {
      ctx.globalAlpha = fade * 0.1;
      circle(ctx, 0, 0, radius);
      ctx.fill();
      ctx.globalAlpha = fade * 0.9;
      circle(ctx, 0, 0, radius * (0.45 + progress * 0.55));
      ctx.stroke();
      ctx.globalAlpha = fade * 0.35;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 8]);
      circle(ctx, 0, 0, radius);
      ctx.stroke();
      ctx.setLineDash([]);
      if (event.abilityKind === 'heal' || event.kind === 'heal') {
        ctx.globalAlpha = fade * 0.6;
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const angle = (i * Math.PI) / 2 + 0.7;
          const x = Math.cos(angle) * radius * 0.6;
          const y = Math.sin(angle) * radius * 0.6 - progress * 15;
          ctx.beginPath();
          ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y);
          ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
          ctx.stroke();
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
    const label = amount !== undefined
      ? `${event.kind === 'heal' ? '+' : '−'}${Math.round(amount)}`
      : event.text || (event.kind === 'death' ? 'SCONFITTO' : event.kind === 'respawn' ? 'RINASCITA' : '');
    if (!label) return;

    ctx.save();
    ctx.translate(event.x, event.y);
    ctx.scale(1, this.viewSign);
    ctx.globalAlpha = Math.min(1, (1 - progress) * 2.5);
    ctx.font = `${amount !== undefined ? '700 14px' : '600 10px'} Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(30,37,28,0.75)';
    ctx.fillStyle = event.color;
    const y = -27 - progress * 35;
    ctx.strokeText(label, 0, y);
    ctx.fillText(label, 0, y);
    ctx.restore();
  }

  private previewActors(classId: ClassId, time: number): Actor[] {
    const def = CLASSES[classId];
    const actor: Actor = {
      id: 'preview',
      kind: 'player',
      name: 'Viandante',
      classId,
      x: this.world.authoring.document.spawn.x * TILE_SIZE,
      y: this.world.authoring.document.spawn.y * TILE_SIZE,
      radius: PLAYER_RADIUS,
      hp: def.maxHp,
      maxHp: def.maxHp,
      resource: def.maxResource,
      maxResource: def.maxResource,
      aim: -0.6 + Math.sin(time * 0.0005) * 0.15,
      speed: def.speed,
      level: 1,
      xp: 0,
      kills: 0,
      deaths: 0,
      teamId: null,
      hidden: false,
      revealedUntil: 0,
      deadUntil: 0,
      spawnProtectedUntil: 0,
      effects: [],
      cooldowns: { basic: 0, q: 0, e: 0, r: 0 },
    };
    const previews: Actor[] = [actor];
    const spawnChunkX = Math.floor(this.world.authoring.document.spawn.x * TILE_SIZE / CHUNK_SIZE);
    const spawnChunkY = Math.floor(this.world.authoring.document.spawn.y * TILE_SIZE / CHUNK_SIZE);
    for (const [cx, cy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      for (const spawn of this.world.getChunk(spawnChunkX + cx, spawnChunkY + cy).npcs) {
        if (!this.visible(spawn)) continue;
        previews.push({
          ...actor,
          ...spawn,
          id: `preview:${spawn.id}`,
          kind: 'npc',
          name: 'Creatura',
          classId: spawn.npcKind === 'wisp' ? 'mage' : spawn.npcKind === 'sentinel' ? 'paladin' : 'warrior',
          radius: spawn.npcKind === 'sentinel' ? 18 : 13,
          hp: 65,
          maxHp: 65,
        });
      }
    }
    return previews;
  }
}
export { drawMinimap } from './minimap';
