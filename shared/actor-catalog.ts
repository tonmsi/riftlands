import defaults from './actor-catalog.json';
import type { BossDefinition } from './bosses';
import type { ClassId, Vec2 } from './types';
import { NPC_DEFINITIONS, type NpcTemplateId } from './npcs';

export type BossTemplate = Omit<BossDefinition, 'dungeonId'>;
export interface SpriteAnimation {
  asset: string; columns: number; rows: number; directional: boolean; loop: boolean;
  frameMs?: number; durationMs?: number; anchor?: Vec2; offset?: Vec2;
}
export interface ActorVisual {
  drawSize: number; anchor: Vec2; offset: Vec2;
  shadow: { x: number; y: number; width: number; height: number; opacity: number };
  animations: Record<string, SpriteAnimation>;
}
export interface ActorCatalog { version: 1; bosses: BossTemplate[]; skins: Record<string, ActorVisual>; npcSkins?: Partial<Record<NpcTemplateId, string>>; playerDrawSizes?: Partial<Record<ClassId, number>>; }
export const DEFAULT_PLAYER_DRAW_SIZE = 48;
export function playerDrawSize(catalog: ActorCatalog, classId: ClassId): number {
  return catalog.playerDrawSizes?.[classId] ?? DEFAULT_PLAYER_DRAW_SIZE;
}
const number = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const point = (p: Vec2 | undefined, min: number, max: number) => !!p && number(p.x, min, max) && number(p.y, min, max);
export function parseActorCatalog(value: unknown): ActorCatalog {
  const c = structuredClone(value) as ActorCatalog;
  const fail = (message: string): never => { throw new Error(`Catalogo attori: ${message}`); };
  if (!c || c.version !== 1 || !Array.isArray(c.bosses) || !c.bosses.length || c.bosses.length > 100
    || !c.skins || typeof c.skins !== 'object' || Array.isArray(c.skins) || Object.keys(c.skins).length > 100) fail('formato non valido.');
  const ids = new Set<string>();
  for (const boss of c.bosses) {
    if (!boss || !/^[a-z0-9-]{1,64}$/.test(boss.id) || ids.has(boss.id) || !boss.name || boss.name.length > 80
      || !Object.hasOwn(c.skins, boss.skin) || !c.skins[boss.skin]?.animations?.idle || !['warrior', 'mage', 'hunter', 'paladin'].includes(boss.classId)
      || !number(boss.radius, 4, 200) || !number(boss.hp, 1, 1e7) || !number(boss.speed, 0, 1000)
      || !number(boss.level, 1, 100) || !number(boss.respawnMs, 1000, 86_400_000)
      || !number(boss.enrageAt, 0, 1) || !number(boss.enrageSpeed, .1, 10) || !number(boss.enrageCooldown, .01, 10)
      || !boss.reward || !number(boss.reward.gold, 0, 1e7) || !number(boss.reward.lootMs, 1000, 86_400_000)
      || !boss.behavior || !['threat', 'nearest'].includes(boss.behavior.targeting)
      || !['sequence', 'distance'].includes(boss.behavior.attackSelection)
      || !number(boss.behavior.preferredRange, 0, 2000) || !number(boss.behavior.pathRefreshMs, 50, 60_000)
      || !Array.isArray(boss.attacks) || !boss.attacks.length || boss.attacks.length > 64) fail('definizione boss non valida.');
    ids.add(boss.id);
    for (const a of boss.attacks) if (!['melee', 'slam', 'charge', 'nova'].includes(a.kind)
      || !number(a.damage, 0, 1e6) || !number(a.range, 1, 5000) || !number(a.radius, 1, 5000)
      || !number(a.windupMs, 0, 60_000) || !number(a.cooldownMs, 50, 60_000)
      || (a.innerRadius !== undefined && !number(a.innerRadius, 0, a.radius))
      || (a.travel !== undefined && !number(a.travel, 0, 5000))) fail('attacco non valido.');
    const u = boss.behavior.unstuck;
    if (u && (!number(u.afterMs, 1, 60_000) || !number(u.durationMs, 1, 60_000) || !number(u.probeDistance, boss.radius + 1, 5000))) fail('recupero percorso non valido.');
  }
  for (const [id, v] of Object.entries(c.skins)) {
    if (!/^[a-z0-9-]{1,64}$/.test(id) || !v || !number(v.drawSize, 8, 1000) || !point(v.anchor, 0, 1)
      || !point(v.offset, -1000, 1000) || !v.shadow || !number(v.shadow.x, -1000, 1000) || !number(v.shadow.y, -1000, 1000)
      || !number(v.shadow.width, 0, 1000) || !number(v.shadow.height, 0, 1000) || !number(v.shadow.opacity, 0, 1)
      || !v.animations || (!v.animations.idle && !v.animations.moving) || Object.keys(v.animations).length > 32) fail('skin non valida.');
    for (const [name, a] of Object.entries(v.animations)) {
      const kind = Object.entries(c.npcSkins ?? {}).find(([, skin]) => skin === id)?.[0];
      const actorName = kind && Object.hasOwn(NPC_DEFINITIONS, kind) ? NPC_DEFINITIONS[kind as NpcTemplateId].name : id;
      const invalid = (reason: string): never => fail(`${actorName} · ${name}: ${reason}`);
      if (!/^[a-z][a-z0-9-]{0,32}$/.test(name) || !a) invalid('definizione animazione non valida.');
      if (!/^\/(actor-assets|world-assets)\/[a-zA-Z0-9_-]+\.(png|svg)$/.test(a.asset)) invalid(`percorso spritesheet non valido: ${String(a.asset)}.`);
      if (!Number.isInteger(a.columns) || !number(a.columns, 1, 32)) invalid('Colonne deve essere un intero da 1 a 32.');
      if (!Number.isInteger(a.rows) || !number(a.rows, 1, 32)) invalid('Righe deve essere un intero da 1 a 32.');
      if (typeof a.directional !== 'boolean' || typeof a.loop !== 'boolean') invalid('Direzioni e ripetizione devono essere opzioni attive o disattive.');
      if (a.directional && a.rows !== 4) invalid(`“4 direzioni, una per riga” richiede 4 righe; ne hai impostate ${a.rows}.`);
      if (a.frameMs !== undefined && !number(a.frameMs, 10, 10_000)) invalid('Tempo frame deve essere da 10 a 10000 ms, oppure vuoto.');
      if (a.durationMs !== undefined && !number(a.durationMs, 50, 60_000)) invalid('Durata totale deve essere da 50 a 60000 ms, oppure vuota.');
      if (a.anchor && !point(a.anchor, 0, 1)) invalid('Anchor X e Y devono essere da 0 a 1.');
      if (a.offset && !point(a.offset, -1000, 1000)) invalid('Offset X e Y devono essere da -1000 a 1000 px.');
    }
  }
  if (c.npcSkins !== undefined) {
    if (!c.npcSkins || typeof c.npcSkins !== 'object' || Array.isArray(c.npcSkins)) fail('skin NPC non valide.');
    for (const [kind, skin] of Object.entries(c.npcSkins)) {
      if (!Object.hasOwn(NPC_DEFINITIONS, kind) || typeof skin !== 'string' || !Object.hasOwn(c.skins, skin)
        || !c.skins[skin].animations.moving) fail('NPC o animazione moving non validi.');
    }
  }
  if (c.playerDrawSizes !== undefined) {
    if (!c.playerDrawSizes || typeof c.playerDrawSizes !== 'object' || Array.isArray(c.playerDrawSizes)) fail('dimensioni player non valide.');
    for (const [classId, size] of Object.entries(c.playerDrawSizes))
      if (!['mage', 'warrior', 'paladin', 'hunter'].includes(classId) || !number(size, 8, 1000)) fail(`dimensione player ${classId}: da 8 a 1000 px.`);
  }
  return c;
}
export const ACTOR_CATALOG = parseActorCatalog(defaults);
