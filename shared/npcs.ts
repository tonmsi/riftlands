export const NPC_CATALOG = {
  slime: { name: 'Gelatina selvatica', radius: 13, speed: 95, classId: 'warrior', color: '#85b46a' },
  wisp: { name: 'Fuoco fatuo', radius: 13, speed: 120, classId: 'mage', color: '#97ddec' },
  sentinel: { name: 'Guardiano errante', radius: 19, speed: 120, classId: 'warrior', color: '#c4a17d' },
} as const;
export type NpcKind = keyof typeof NPC_CATALOG;
/** Distances are world pixels; attack/respawn timings are milliseconds. */
export const NPC_COMBAT = {
  slime: { retaliatesOnly: true, aggroRadius: 370, attackRange: 43, windupMs: 400, cooldownMs: 1300, respawnMs: 120_000 },
  wisp: { retaliatesOnly: false, aggroRadius: 370, attackRange: 230, windupMs: 0, cooldownMs: 1900, respawnMs: 120_000 },
  sentinel: { retaliatesOnly: false, aggroRadius: 370, attackRange: 43, windupMs: 650, cooldownMs: 1300, respawnMs: 120_000 },
} as const;
/** Manual characters and hostile spawn types share definitions, without mixing quest givers into population weights. */
export interface NpcWanderBehavior { kind: 'wander'; radius: number; pauseMs: readonly [number, number]; }
interface NpcTemplate { name: string; radius: number; speed: number; classId: 'warrior' | 'mage'; color: string; disposition: 'hostile' | 'neutral'; dialogueId?: string; behavior?: NpcWanderBehavior; }
const hostileTemplates = Object.fromEntries(Object.entries(NPC_CATALOG).map(([id, spec]) => [id, { ...spec, disposition: 'hostile' }])) as {
  [K in NpcKind]: typeof NPC_CATALOG[K] & { disposition: 'hostile'; dialogueId?: string; behavior?: NpcWanderBehavior }
};
export const NPC_DEFINITIONS = {
  ...hostileTemplates,
  'wounded-scout': { name: 'Daro, soldato ferito', radius: 18, speed: 14, classId: 'warrior' as const, color: '#947f72', disposition: 'neutral' as const, dialogueId: 'wounded-scout', behavior: { kind: 'wander', radius: 48, pauseMs: [3500, 6000] } },
  platos: { name: 'Platos, il vecchio', radius: 18, speed: 18, classId: 'mage' as const, color: '#a79e83', disposition: 'neutral' as const, dialogueId: 'platos', behavior: { kind: 'wander', radius: 80, pauseMs: [2500, 4500] } },
  'north-scout': { name: 'Rovan, esploratore', radius: 18, speed: 30, classId: 'warrior' as const, color: '#8c9270', disposition: 'neutral' as const, dialogueId: 'north-scout', behavior: { kind: 'wander', radius: 72, pauseMs: [2000, 4000] } },
  'dock-skeptic': { name: 'Brugo, abitante del porto', radius: 18, speed: 26, classId: 'warrior' as const, color: '#9b785e', disposition: 'neutral' as const, dialogueId: undefined, behavior: { kind: 'wander', radius: 64, pauseMs: [2000, 4000] } },
  'arena-bookmaker': { name: 'Silas, maestro delle quote', radius: 18, speed: 24, classId: 'mage' as const, color: '#e3b95d', disposition: 'neutral' as const, dialogueId: 'arena-bookmaker', behavior: { kind: 'wander', radius: 48, pauseMs: [2000, 4000] } },
  'old-fisher': { name: 'Nereo, vecchio pescatore', radius: 18, speed: 30, classId: 'warrior' as const, color: '#bfa988', disposition: 'neutral' as const, dialogueId: 'old-fisher', behavior: { kind: 'wander', radius: 96, pauseMs: [2000, 4000] } },
  'outpost-vendor': { name: 'Ada, mercante', radius: 18, speed: 0, classId: 'warrior' as const, color: '#ab89c2', disposition: 'neutral' as const, dialogueId: 'outpost-shop', behavior: undefined },
} satisfies Readonly<Record<string, NpcTemplate>>;
export type NpcTemplateId = keyof typeof NPC_DEFINITIONS;
