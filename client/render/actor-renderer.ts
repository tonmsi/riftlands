import { CatalogSpriteRenderer } from './catalog-sprite-renderer';
import { rasterizeSpriteSheet, type RasterSpriteSheet } from './sprite-sheet';
import { circle, polygon } from './render-primitives';
import { CLASSES, PLAYER_RADIUS } from '../../shared/config';
import type { Actor, ClassId, Vec2 } from '../../shared/types';
import { type BossWindup } from '../../shared/bosses';
import { playerSpriteDirectionRow } from './sprite-direction';
import { DEFAULT_PLAYER_DRAW_SIZE } from '../../shared/actor-catalog';
const CLASS_SPRITE_URLS: Partial<Record<ClassId, string>> = {
  paladin: new URL('../../assets/paladino256.png', import.meta.url).href,
  mage: new URL('../../assets/mage256.png', import.meta.url).href,
  warrior: new URL('../../assets/warrior256.png', import.meta.url).href,
};
const FRAME_SIZE = 256;

const SPRITE_COLUMNS = 4;

const TAU = Math.PI * 2;
/** Character sheets, procedural fallbacks and per-actor animation history. */
export class ActorRenderer {
  private readonly classSprites = new Map<ClassId, RasterSpriteSheet>();
  private readonly classMotion = new Map<string, { x: number; y: number; row: number; startedAt: number; moving: boolean }>();
  private readonly actorSprites = new CatalogSpriteRenderer();
  private playerSizes?: Partial<Record<ClassId, number>>;
  /** Preview overrides; gameplay reads the saved shared catalog. */
  setPlayerDrawSizes(sizes: Partial<Record<ClassId, number>>): void { this.playerSizes = { ...sizes }; }
  playerDrawSize(classId: ClassId): number { return this.playerSizes?.[classId] ?? this.actorSprites.playerDrawSize(classId); }
  readonly spritesReady: Promise<void>;
  constructor(private readonly ctx: CanvasRenderingContext2D, private readonly touchQuery: MediaQueryList) {
    this.spritesReady = this.prepareSprites();
  }
  reset(): void { this.classMotion.clear(); }
  retainMotion(ids: ReadonlySet<string>): void {
    for (const id of this.classMotion.keys()) if (!ids.has(id)) this.classMotion.delete(id);
  }
  private async prepareSprites(): Promise<void> {
    await this.actorSprites.prepare();
    const jobs: Promise<void>[] = [];

    for (const [classId, url] of Object.entries(CLASS_SPRITE_URLS) as [ClassId, string][]) {
      jobs.push(rasterizeSpriteSheet(url, FRAME_SIZE, Math.min(FRAME_SIZE / 2, this.playerDrawSize(classId)))
        .then(sprite => { this.classSprites.set(classId, sprite); })
        .catch(error => { console.warn(error); }));
    }
    await Promise.all(jobs);
  }
  drawActor(
    actor: Actor,
    time: number,
    self: boolean,
    allied: boolean,
    selected: boolean,
    hitTargets: ReadonlySet<string>,
    moveDirection?: Vec2 | null,
    windup?: BossWindup,
    detailed = true,
    viewSign = 1
  ): void {
    const { ctx } = this;
    const dead = actor.hp <= 0;
    const color = dead ? '#91968a' : CLASSES[actor.classId].color;
    const r = actor.radius || PLAYER_RADIUS;
    ctx.save();
    ctx.translate(actor.x, actor.y);
    ctx.scale(1, viewSign);
    if (viewSign === -1) {
      actor = { ...actor, y: -actor.y, aim: -actor.aim,
        spriteRow: actor.spriteRow === 0 ? 1 : actor.spriteRow === 1 ? 0 : actor.spriteRow };
      if (moveDirection) moveDirection = { x: moveDirection.x, y: -moveDirection.y };
    }

    if (actor.hidden) ctx.globalAlpha = self || allied ? 0.58 : 0.32;
    if (actor.dialogueId) {
      ctx.strokeStyle = actor.questMarker === 'available' ? '#ead182' : actor.questMarker === 'active' ? '#8ac6bf' : '#b1b6a0'; ctx.lineWidth = 2;
      if (actor.questMarker === 'active') ctx.setLineDash([5, 3]);
      circle(ctx, 0, 0, r + 6); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = 'bold 14px system-ui'; ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'center';
      ctx.fillText(actor.npcKind === 'arena-bookmaker' ? '♠' : actor.npcKind === 'outpost-vendor' ? '¤' : actor.questMarker === 'available' ? '!' : actor.questMarker === 'active' ? '…' : '•', 0, -r - 12);
    }
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
    if (dead) ctx.globalAlpha = actor.npcKind === 'boss' ? 0.75 : 0.45;
    if (detailed && !(actor.kind === 'npc' && this.actorSprites.shadow(ctx, actor))) {
      ctx.fillStyle = 'rgba(36, 48, 37, 0.28)';
      ctx.beginPath();
      ctx.ellipse(1, 13, r + 5, r * 0.56, 0, 0, TAU);
      ctx.fill();
    }
    if (self || allied || selected) {
      ctx.strokeStyle = self ? '#f1e7c2' : allied ? '#abd6c0' : '#f0b7a0';
      ctx.lineWidth = selected ? 2 : 1.5;
      if (!self && !selected) ctx.setLineDash([3, 4]);
      circle(ctx, 0, 0, r + 7);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (selected) {
      polygon(ctx, [-4, -r - 38, 4, -r - 38, 0, -r - 33]);
      ctx.fillStyle = '#f5dcba';
      ctx.fill();
    }
    if (actor.spawnProtectedUntil > time || actor.effects.some(effect => effect.kind === 'shield' && effect.until > time)) {
      ctx.strokeStyle = actor.spawnProtectedUntil > time ? 'rgba(199,235,213,0.65)' : '#f1dfad';
      ctx.lineWidth = 2;
      circle(ctx, 0, 0, r + 12 + Math.sin(time * 0.005) * 1.5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,242,195,0.06)';
      ctx.fill();
    }
    if (actor.effects.some(effect => effect.kind === 'power' && effect.until > time)) {
      ctx.strokeStyle = '#eacf82';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      circle(ctx, 0, 0, r + 10);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (actor.effects.some(effect => effect.kind === 'weakness' && effect.until > time)) {
      ctx.strokeStyle = '#c798db';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-5, r + 13); ctx.lineTo(0, r + 17); ctx.lineTo(5, r + 13);
      ctx.stroke();
    }
    if (actor.effects.some(effect => effect.kind === 'slow' && effect.until > time)) {
      ctx.strokeStyle = '#9ddfea';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r, r + 3); ctx.lineTo(r, r + 3);
      ctx.stroke();
    }
    if (actor.effects.some(effect => effect.kind === 'haste' && effect.until > time)) {
      ctx.save();
      ctx.rotate(actor.aim);
      ctx.strokeStyle = 'rgba(180,224,224,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r - 5, -5); ctx.lineTo(-r - 15, -5);
      ctx.moveTo(-r - 5, 5); ctx.lineTo(-r - 12, 5);
      ctx.stroke();
      ctx.restore();
    }

    if (actor.kind === 'npc') this.drawNpc(actor, time, color, windup);
    else this.drawPlayer(actor, color, dead, time, moveDirection);

    if (!dead && hitTargets.has(actor.id)) {
      circle(ctx, 0, 0, r + 2);
      ctx.fillStyle = 'rgba(255,241,221,0.48)';
      ctx.fill();
    }
    if (self && !dead) {
      ctx.save();
      ctx.rotate(actor.aim);
      polygon(ctx, [r + 15, -3, r + 20, 0, r + 15, 3]);
      ctx.fillStyle = '#f2eacb';
      ctx.fill();
      ctx.restore();
    }
    if (actor.disposition !== 'neutral' && (actor.kind === 'player' || selected || actor.hp < actor.maxHp || actor.npcKind === 'boss')) {
      const barWidth = actor.kind === 'player' ? 42 : 32;
      const barY = -r - 11;
      ctx.fillStyle = 'rgba(24,32,24,0.75)';
      ctx.fillRect(-barWidth / 2 - 1, barY - 1, barWidth + 2, 5);
      ctx.fillStyle = self || allied ? '#c7d59d' : actor.kind === 'npc' ? '#dab07f' : '#d49381';
      ctx.fillRect(-barWidth / 2, barY, barWidth * Math.max(0, Math.min(1, actor.hp / actor.maxHp)), 3);

      if (actor.kind === 'player' && detailed) {
        ctx.textAlign = 'center';
        ctx.font = `${self ? '600' : '500'} 10px Inter, system-ui, sans-serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(34,43,29,0.65)';
        const label = `${actor.name.slice(0, 20)}${self ? ' · tu' : ''}`;
        ctx.strokeText(label, 0, barY - 7);
        ctx.fillStyle = self ? '#faf2d8' : allied ? '#ceebd6' : '#e7e6d7';
        ctx.fillText(label, 0, barY - 7);
      } else if (selected || actor.npcKind === 'boss') {
        ctx.textAlign = 'center';
        ctx.font = '500 9px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#f0e8cf';
        ctx.fillText(actor.npcKind === 'boss' && dead ? `Cadavere · ${Math.max(0, Math.ceil((actor.deadUntil - time) / 1000))}s` : `${actor.name} · ${actor.level}`, 0, barY - 6);
      }
    }
    if (actor.hidden && self) {
      ctx.globalAlpha = 1;
      ctx.font = '500 9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e0e8be';
      ctx.fillText('NASCOSTO', 0, r + 29);
    }
    ctx.restore();
  }
  private drawPlayer(actor: Actor, color: string, dead: boolean, time: number, moveDirection?: Vec2 | null): void {
    const { ctx } = this;
    const drawSize = this.playerDrawSize(actor.classId);
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
      ctx.drawImage(cachedFrame, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      return;
    }
    ctx.save(); ctx.scale(drawSize / DEFAULT_PLAYER_DRAW_SIZE, drawSize / DEFAULT_PLAYER_DRAW_SIZE);
    this.drawPlayerFallback(actor, color, dead);
    ctx.restore();
  }
  private drawPlayerFallback(actor: Actor, color: string, dead: boolean): void {
    const { ctx } = this, r = actor.radius;
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
    } else if (actor.classId === 'paladin') {
      polygon(ctx, [-8, -8, 8, -8, 8, 2, 4, 8, 0, 11, -4, 8, -8, 2]); ctx.fill();
      ctx.strokeStyle = '#74643d'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 6); ctx.moveTo(-4, -1); ctx.lineTo(4, -1); ctx.stroke();
      ctx.save(); ctx.rotate(actor.aim); ctx.strokeStyle = '#d9c38e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(24, 10); ctx.stroke();
      ctx.fillStyle = '#eaddb3'; ctx.fillRect(20, 4, 8, 12); ctx.restore();
    } else if (actor.classId === 'hunter') {
      polygon(ctx, [-7, -7, 0, -11, 7, -7, 7, 7, -7, 7]);
      ctx.fill();
      ctx.strokeStyle = '#394d33';
      ctx.lineWidth = 1.3;
      ctx.stroke();

      ctx.save();
      ctx.rotate(actor.aim);
      ctx.strokeStyle = '#855d37';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(12, 0, 15, -Math.PI * 0.38, Math.PI * 0.38);
      ctx.stroke();

      ctx.strokeStyle = '#e2ebd8';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(12 + Math.cos(-Math.PI * 0.38) * 15, Math.sin(-Math.PI * 0.38) * 15);
      ctx.lineTo(6, 0);
      ctx.lineTo(12 + Math.cos(Math.PI * 0.38) * 15, Math.sin(Math.PI * 0.38) * 15);
      ctx.stroke();

      ctx.strokeStyle = '#effae8';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(23, 0); ctx.stroke();
      polygon(ctx, [23, -2.5, 27, 0, 23, 2.5]);
      ctx.fillStyle = '#aff598';
      ctx.fill();
      ctx.restore();
    }
  }
  private drawNpc(actor: Actor, time: number, color: string, windup?: BossWindup): void {
    const { ctx } = this;
    const r = actor.radius;

    // --- LOGICA DI MOVIMENTO (spostata in alto per sapere subito se si muove) ---
    const previous = this.classMotion.get(actor.id);
    const dx = previous ? actor.x - previous.x : 0;
    const dy = previous ? actor.y - previous.y : 0;
    const distance = Math.hypot(dx, dy);

    // Margine di tolleranza per evitare sfarfallii sui muri (se era in moto e fa micro-passi, resta in moto)
    const moving = actor.spriteMoving ?? (distance > 0.02 || (previous?.moving === true && distance > 0.005));
    let row = actor.spriteRow ?? previous?.row ?? 0;

    if (moving && actor.spriteRow === undefined) {
      // Usiamo playerSpriteDirectionRow per applicare la tolleranza sulle diagonali
      row = playerSpriteDirectionRow(dx, dy, row, true);
    }
    // -------------------------------------------------------------------------

    if (actor.npcKind === "boss" && this.actorSprites.draw(ctx, actor, time, moving, row, windup)) return;
    const motionStartedAt = previous && previous.moving === moving && previous.row === row ? previous.startedAt : time;
    this.classMotion.set(actor.id, { x: actor.x, y: actor.y, row, startedAt: motionStartedAt, moving });
    if (actor.npcKind !== 'boss' && this.actorSprites.drawNpc(ctx, actor, time - motionStartedAt, moving, row)) {
      if (actor.disposition === 'neutral') { ctx.fillStyle = '#eee7ce'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(actor.name.split(',')[0], 0, r + 19); }
      return;
    }
    // === VECCHIO CODICE GRAFICA PROCEDURALE DI FALLBACK ===
    if (actor.disposition === 'neutral') {
      ctx.save(); if (moving) ctx.translate(0, Math.sin(time * .008) * 1.2);
      const merchant = actor.npcKind === 'outpost-vendor';
      const bookmaker = actor.npcKind === 'arena-bookmaker';
      const gradient = ctx.createRadialGradient(-5, -7, 1, 0, 0, r); gradient.addColorStop(0, merchant ? '#d6ba9f' : '#cfbf9a'); gradient.addColorStop(1, merchant ? '#937b69' : '#78795d');
      ctx.fillStyle = gradient; circle(ctx, 0, 0, r); ctx.fill(); ctx.strokeStyle = '#343d30'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = bookmaker ? '#303d65' : merchant ? '#82659f' : '#e1e0cc'; ctx.beginPath(); ctx.ellipse(0, 7, 11, 7, 0, 0, TAU); ctx.fill();
      if (bookmaker) {
        ctx.fillStyle = '#26334e'; ctx.fillRect(-10, -20, 20, 10); ctx.fillRect(-15, -11, 30, 4);
        ctx.fillStyle = '#e1bd70'; ctx.fillRect(-10, -13, 20, 2); circle(ctx, 0, 7, 3); ctx.fill();
      }
      if (merchant) {
        ctx.fillStyle = '#82659f'; polygon(ctx, [-r - 3, -8, -r + 4, -17, r - 4, -17, r + 3, -8]); ctx.fill();
        ctx.strokeStyle = '#ead182'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-r + 2, -9); ctx.lineTo(r - 2, -9); ctx.stroke();
        ctx.fillStyle = '#bc945e'; ctx.beginPath(); ctx.roundRect(6, 4, 10, 11, 3); ctx.fill();
      }
      ctx.fillStyle = '#30392d'; circle(ctx, -5, -3, 1.8); ctx.fill(); circle(ctx, 5, -3, 1.8); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#eee7ce'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(merchant ? 'Ada · Mercante' : actor.name.split(',')[0], 0, r + 19); return;
    }
    ctx.strokeStyle = '#3c483b'; ctx.lineWidth = 1.8;
    if (actor.npcKind === 'boss') {
      if (actor.hp <= 0) {
        ctx.fillStyle = '#9c9479';
        for (const [x, y] of [[-22, 0], [-2, 7], [20, -2]]) {
          polygon(ctx, [x - 10, y - 8, x + 9, y - 7, x + 12, y + 9, x - 7, y + 12]);
          ctx.fill();
          ctx.stroke();
        }
      } else if (actor.bossSkin === 'stone-warden') {
        ctx.fillStyle = '#a99b76';
        polygon(ctx, [-29, -12, -20, -28, 20, -28, 29, -12, 24, 23, -24, 23]);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#675b48';
        ctx.fillRect(-14, -19, 28, 22);
        ctx.fillStyle = '#eac773';
        ctx.fillRect(-10, -12, 6, 4);
        ctx.fillRect(4, -12, 6, 4);
        ctx.strokeStyle = '#e6c279';
        polygon(ctx, [0, 6, 7, 14, 0, 23, -7, 14]);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#443a49';
        polygon(ctx, [-24, -19, -12, -29, 0, -22, 12, -29, 24, -19, 27, 18, 0, 29, -27, 18]);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#d47a56';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-13, -21); ctx.quadraticCurveTo(-28, -36, -34, -19);
        ctx.moveTo(13, -21); ctx.quadraticCurveTo(28, -36, 34, -19);
        ctx.stroke();
        ctx.fillStyle = '#f0a16e';
        ctx.fillRect(-10, -10, 6, 4);
        ctx.fillRect(4, -10, 6, 4);
        ctx.save();
        ctx.rotate(actor.aim);
        ctx.strokeStyle = '#b86b50';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(8, 8); ctx.lineTo(34, 8);
        ctx.stroke();
        ctx.restore();
      }
    } else if (actor.npcKind === 'wisp') {
      const bob = Math.sin(time * 0.003 + actor.x) * 2;
      polygon(ctx, [0, -r + bob, r * 0.7, bob, 0, r + bob, -r * 0.7, bob]);
      ctx.fillStyle = '#b4c6c5';
      ctx.fill();
      ctx.stroke();
      circle(ctx, 0, bob, 3);
      ctx.fillStyle = '#edf3db';
      ctx.fill();
    } else if (actor.npcKind === 'sentinel') {
      polygon(ctx, [-r * 0.75, -r * 0.7, r * 0.55, -r, r, r * 0.2, r * 0.6, r * 0.8, -r * 0.7, r * 0.7, -r, -r * 0.1]);
      ctx.fillStyle = '#a5a18a';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#e5c68c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-5, -1); ctx.lineTo(5, -1);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.ellipse(0, 1, r, r * 0.8 + Math.sin(time * 0.003 + actor.y) * 0.8, 0, 0, TAU);
      ctx.fillStyle = actor.hp <= 0 ? color : '#a5b981';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(225,238,190,0.35)';
      ctx.beginPath();
      ctx.ellipse(-4, -4, 5, 2.5, -0.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#3f4a37';
      circle(ctx, -4, 1, 1.5);
      ctx.fill();
      circle(ctx, 4, 1, 1.5);
      ctx.fill();
    }
  }
}
