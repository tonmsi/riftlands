import { SOUL_COUNT, SOUL_FAREWELL_MS } from '../../shared/soul-escort';
import type { Actor } from '../../shared/types';

const COLORS = ['160,235,255', '196,185,255', '255,222,159', '170,255,218', '221,235,255'];
const TAU = Math.PI * 2;
function seed(id: string): number { let n = 0; for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0; return (n % 997) / 997 * TAU; }
export function soulPosition(index: number, seconds: number, phase: number, farewell = 0): { x: number; y: number } {
  const angle = phase + index * TAU / SOUL_COUNT + seconds * .72 + Math.sin(seconds * (.8 + index * .07) + index) * .24;
  const radius = 48 + index * 4 + Math.sin(seconds * 1.13 + index * 2.4) * 8;
  const gather = 1 - Math.min(1, farewell / 2200) * .55;
  const rise = Math.max(0, farewell - 2200) / 6800;
  return { x: Math.cos(angle) * radius * gather + Math.sin(index * 2.7) * rise * 48,
    y: Math.sin(angle) * radius * .72 * gather - 18 + Math.sin(seconds * 1.7 + index) * 7 - rise * rise * (100 + index * 15) };
}
/** Five souls are visual companions, never collision bodies or combat targets. */
export function drawSoulLights(ctx: CanvasRenderingContext2D, actor: Actor, time: number): void {
  const farewell = actor.soulFarewellAt === undefined ? 0 : Math.max(0, time - actor.soulFarewellAt);
  if (actor.hp <= 0 || (!actor.soulEscort && actor.soulFarewellAt === undefined) || farewell >= SOUL_FAREWELL_MS) return;
  const originX = actor.soulFarewellAt === undefined ? 0 : (actor.soulFarewellX ?? actor.x) - actor.x;
  const originY = actor.soulFarewellAt === undefined ? 0 : (actor.soulFarewellY ?? actor.y) - actor.y;
  const phase = seed(actor.id), seconds = time / 1000;
  const fade = 1 - Math.max(0, farewell - 4200) / 4800;
  ctx.save(); ctx.translate(originX, originY); ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha *= fade;
  const halo = ctx.createRadialGradient(0, -8, 2, 0, -8, 66);
  halo.addColorStop(0, 'rgba(159,229,255,.14)'); halo.addColorStop(.45, 'rgba(179,188,255,.07)'); halo.addColorStop(1, 'rgba(159,229,255,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.ellipse(0, -8, 66, 42, 0, 0, TAU); ctx.fill();
  for (let i = 0; i < SOUL_COUNT; i++) {
    const point = soulPosition(i, seconds, phase, farewell);
    const pulse = 1 + Math.sin(seconds * (2 + i * .13) + i) * .2;
    ctx.beginPath();
    for (let j = 7; j >= 0; j--) {
      const p = soulPosition(i, seconds - j * .045, phase, Math.max(0, farewell - j * 45));
      if (j === 7) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = `rgba(${COLORS[i]},.28)`; ctx.lineWidth = 1.3; ctx.stroke();
    const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 15 * pulse);
    glow.addColorStop(0, 'rgba(255,255,245,.98)'); glow.addColorStop(.13, `rgba(${COLORS[i]},.9)`);
    glow.addColorStop(.4, `rgba(${COLORS[i]},.24)`); glow.addColorStop(1, `rgba(${COLORS[i]},0)`);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(point.x, point.y, 15 * pulse, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fffbe9'; ctx.beginPath(); ctx.ellipse(point.x, point.y, 1.7 * pulse, 2.6 * pulse, .2, 0, TAU); ctx.fill();
    if (farewell > 1700) {
      ctx.strokeStyle = `rgba(${COLORS[i]},.18)`; ctx.lineWidth = .7;
      ctx.beginPath(); ctx.moveTo(point.x, point.y + 7); ctx.lineTo(point.x, point.y - 20 - farewell / 180); ctx.stroke();
    }
  }
  ctx.restore();
}
