import type { BossDefinition } from './bosses';
/** Reusable behaviors. A template does not install a boss or a dungeon in the world. */
export type BossTemplate = Omit<BossDefinition, 'dungeonId'>;
export const STONE_WARDEN: BossTemplate = {
  id: 'stone-warden',
  name: 'Custode delle Rovine', skin: 'stone-warden', classId: 'warrior',
  radius: 28, hp: 460, speed: 100, level: 5,
  attacks: [
    { kind: 'melee', damage: 18, range: 82, radius: 82, windupMs: 0, cooldownMs: 1450 },
    { kind: 'slam', damage: 31, range: 285, radius: 145, windupMs: 850, cooldownMs: 1450 },
    { kind: 'melee', damage: 18, range: 82, radius: 82, windupMs: 0, cooldownMs: 1450 },
    { kind: 'charge', damage: 27, range: 285, radius: 38, windupMs: 700, cooldownMs: 1450, travel: 250 },
    { kind: 'melee', damage: 18, range: 82, radius: 82, windupMs: 0, cooldownMs: 1450 },
    { kind: 'nova', damage: 24, range: 285, radius: 235, innerRadius: 82, windupMs: 1100, cooldownMs: 1450 },
  ],
  behavior: {
    targeting: 'threat', attackSelection: 'sequence', preferredRange: 68, pathRefreshMs: 550,
    unstuck: { afterMs: 900, durationMs: 550, probeDistance: 54 },
  },
  enrageAt: 0.45, enrageSpeed: 1.24, enrageCooldown: 0.72,
  reward: { gold: 50, lootMs: 120_000 }, respawnMs: 60_000,
};

/** No dedicated sprite exists for this boss: clients intentionally use the procedural fallback. */
export const MAZE_STALKER: BossTemplate = {
  id: 'maze-stalker',
  name: 'Predatore del Dedalo', skin: 'maze-stalker', classId: 'warrior',
  radius: 25, hp: 620, speed: 118, level: 8,
  attacks: [
    { kind: 'charge', damage: 34, range: 330, radius: 34, windupMs: 520, cooldownMs: 1050, travel: 300 },
    { kind: 'melee', damage: 21, range: 76, radius: 76, windupMs: 0, cooldownMs: 900 },
    { kind: 'slam', damage: 27, range: 190, radius: 105, windupMs: 620, cooldownMs: 1000 },
    { kind: 'nova', damage: 22, range: 280, radius: 210, innerRadius: 105, windupMs: 850, cooldownMs: 1200 },
  ],
  behavior: { targeting: 'nearest', attackSelection: 'distance', preferredRange: 105, pathRefreshMs: 260 },
  enrageAt: 0.55, enrageSpeed: 1.38, enrageCooldown: 0.62,
  reward: { gold: 75, lootMs: 120_000 }, respawnMs: 75_000,
};

export const BOSS_TEMPLATES: readonly BossTemplate[] = [STONE_WARDEN, MAZE_STALKER];
export const BOSS_TEMPLATE_BY_ID = new Map(BOSS_TEMPLATES.map(template => [template.id, template]));
