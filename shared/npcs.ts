export const NPC_CATALOG = {
  slime: { name: 'Gelatina selvatica', radius: 13, speed: 95, classId: 'warrior', color: '#85b46a' },
  wisp: { name: 'Fuoco fatuo', radius: 13, speed: 120, classId: 'mage', color: '#97ddec' },
  sentinel: { name: 'Guardiano errante', radius: 19, speed: 120, classId: 'warrior', color: '#c4a17d' },
} as const;
export type NpcKind = keyof typeof NPC_CATALOG;
