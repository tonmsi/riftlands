import { ACTOR_CATALOG, parseActorCatalog, playerDrawSize, type ActorCatalog, type ActorVisual } from '../../shared/actor-catalog';
import type { Actor, ClassId } from '../../shared/types';
import type { BossWindup } from '../../shared/bosses';
import { playerSpriteDirectionRow } from './sprite-direction';
import { ActorSpriteRenderer } from './actor-sprite-renderer';
import { bossAnimation } from './actor-animation';

function loadCatalog(): Promise<ActorCatalog> {
  return fetch('/api/actor-catalog', { cache: 'no-store' }).then(async response => {
    if (!response.ok) return ACTOR_CATALOG;
    return parseActorCatalog((await response.json()).catalog);
  }).catch(error => { console.warn('Catalogo attori non disponibile', error); return ACTOR_CATALOG; });
}
export class CatalogSpriteRenderer {
  private catalog = ACTOR_CATALOG;
  private readonly sprites = new ActorSpriteRenderer();
  playerDrawSize(classId: ClassId): number { return playerDrawSize(this.catalog, classId); }
  async prepare(): Promise<void> {
    this.catalog = await loadCatalog();
    await Promise.all(Object.values({ ...ACTOR_CATALOG.skins, ...this.catalog.skins }).map(v => this.sprites.prepare(v).catch(error => console.warn(error))));
  }
  visual(actor: Actor): ActorVisual | undefined {
    const skin = actor.npcKind === 'boss' ? actor.bossSkin : actor.npcKind ? this.catalog.npcSkins?.[actor.npcKind] ?? ACTOR_CATALOG.npcSkins?.[actor.npcKind] : undefined;
    return skin ? this.catalog.skins[skin] ?? ACTOR_CATALOG.skins[skin] : undefined;
  }
  drawNpc(ctx: CanvasRenderingContext2D, actor: Actor, elapsed: number, moving: boolean, row: number): boolean {
    const visual = this.visual(actor); if (!visual || actor.hp <= 0 && actor.npcKind !== 'fallen-soldier') return false;
    return this.sprites.draw(ctx, visual, { name: moving ? 'moving' : 'idle', elapsed }, row);
  }
  draw(ctx: CanvasRenderingContext2D, actor: Actor, time: number, moving: boolean, row: number, windup?: BossWindup): boolean {
    const visual = this.visual(actor); if (!visual) return false;
    if (actor.hp <= 0 && !visual.animations.death) return false;
    const state = bossAnimation(actor, time, moving, windup, visual.animations.melee?.durationMs ?? 520);
    if (state.name === 'idle' && !visual.animations.idle.loop) state.frozen = true;
    if (state.name === 'melee') row = playerSpriteDirectionRow(Math.cos(actor.aim), Math.sin(actor.aim), row, true);
    return this.sprites.draw(ctx, visual, state, row);
  }
  shadow(ctx: CanvasRenderingContext2D, actor: Actor): boolean {
    const visual = this.visual(actor); if (!visual) return false;
    this.sprites.drawShadow(ctx, visual); return true;
  }
}
