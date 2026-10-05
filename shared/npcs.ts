export const NPC_CATALOG = {
  slime: { name: 'Gelatina selvatica', radius: 13, speed: 95, classId: 'warrior', color: '#85b46a' },
  wisp: { name: 'Fuoco fatuo', radius: 13, speed: 120, classId: 'mage', color: '#97ddec' },
  sentinel: { name: 'Guardiano errante', radius: 19, speed: 120, classId: 'warrior', color: '#c4a17d' },
} as const;
export type NpcKind = keyof typeof NPC_CATALOG;
/** Manual characters and hostile spawn types share definitions, without mixing quest givers into population weights. */
export interface NpcWanderBehavior { kind: 'wander'; radius: number; pauseMs: readonly [number, number]; }
interface NpcTemplate { name: string; radius: number; speed: number; classId: 'warrior' | 'mage'; color: string; disposition: 'hostile' | 'neutral'; dialogueId?: string; behavior?: NpcWanderBehavior; }
const hostileTemplates = Object.fromEntries(Object.entries(NPC_CATALOG).map(([id, spec]) => [id, { ...spec, disposition: 'hostile' }])) as {
  [K in NpcKind]: typeof NPC_CATALOG[K] & { disposition: 'hostile'; dialogueId?: string; behavior?: NpcWanderBehavior }
};
export const NPC_DEFINITIONS = {
  ...hostileTemplates,
  'old-fisher': { name: 'Nereo, vecchio pescatore', radius: 18, speed: 30, classId: 'warrior' as const, color: '#bfa988', disposition: 'neutral' as const, dialogueId: 'old-fisher', behavior: { kind: 'wander', radius: 96, pauseMs: [2000, 4000] } },
  'outpost-vendor': { name: 'Ada, mercante', radius: 18, speed: 0, classId: 'warrior' as const, color: '#ab89c2', disposition: 'neutral' as const, dialogueId: 'outpost-shop', behavior: undefined },
} satisfies Readonly<Record<string, NpcTemplate>>;
export type NpcTemplateId = keyof typeof NPC_DEFINITIONS;
