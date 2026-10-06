import { ACTOR_CATALOG, type BossTemplate } from "./actor-catalog";
export type { BossTemplate };
export const BOSS_TEMPLATES: readonly BossTemplate[] = [...ACTOR_CATALOG.bosses];
export const BOSS_TEMPLATE_BY_ID = new Map(BOSS_TEMPLATES.map(template => [template.id, template]));
export const STONE_WARDEN = BOSS_TEMPLATE_BY_ID.get("stone-warden")!;
export const MAZE_STALKER = BOSS_TEMPLATE_BY_ID.get("maze-stalker")!;
