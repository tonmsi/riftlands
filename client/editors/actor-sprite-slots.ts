import { CLASSES } from '../../shared/config';
import { NPC_COMBAT, type NpcTemplateId } from '../../shared/npcs';
import type { ClassId } from '../../shared/types';
import type { BossAttackDefinition } from '../../shared/bosses';

const abilityTypes: Record<string, string> = {
  projectile: 'Ranged', melee: 'Melee', area: 'AoE', trap: 'AoE',
  dash: 'Scatto', heal: 'Cura', shield: 'Scudo',
};
const animationLabels: Record<string, string> = {
  moving: 'Movimento', idle: 'Idle', death: 'Morte',
  ranged: 'Ranged', projectile: 'Ranged', melee: 'Melee', aoe: 'AoE', area: 'AoE',
  walk: 'Movimento', charge: 'Melee', slam: 'AoE', nova: 'AoE', prep: 'Preparazione',
};

/** Display names are independent of the animation IDs stored in existing catalogs. */
export function characterSpriteSlots(animations: readonly string[], character: { classId: ClassId } | { npcKind: NpcTemplateId }) {
  const labels = { ...animationLabels };
  let attackIds: string[];
  if ('classId' in character) {
    const abilities = CLASSES[character.classId].abilities;
    attackIds = Object.keys(abilities);
    for (const [id, ability] of Object.entries(abilities))
      labels[id] = [abilityTypes[ability.kind], ability.name?.trim()].filter(Boolean).join(' · ');
  } else {
    const hasCombat = Object.hasOwn(NPC_COMBAT, character.npcKind);
    attackIds = hasCombat ? ['basic'] : ['melee', 'ranged', 'aoe'];
    labels.basic = character.npcKind === 'wisp' ? 'Ranged' : 'Melee';
  }
  return [...new Set(['moving', 'idle', ...attackIds, 'death', ...animations])].map(id => ({
    id, label: labels[id] ?? (['q', 'e', 'r'].includes(id) ? `Attacco aggiuntivo ${['q', 'e', 'r'].indexOf(id) + 1}` : id),
  }));
}

export function bossSpriteSlots(animations: readonly string[], attacks: readonly BossAttackDefinition[]) {
  const labels: Record<string, string> = { ...animationLabels, prep: 'Risveglio', charge: 'Melee · Carica', slam: 'AoE · Schianto', nova: 'AoE · Nova' };
  const kinds = [...new Set(attacks.map(attack => attack.kind))];
  for (const kind of kinds) {
    const names = [...new Set(attacks.filter(attack => attack.kind === kind).map(attack => attack.name?.trim()).filter(Boolean))];
    if (names.length) labels[kind] = `${kind === 'melee' || kind === 'charge' ? 'Melee' : 'AoE'} · ${names.join(' / ')}`;
  }
  return [...new Set(['moving', 'idle', 'prep', ...kinds, 'death', ...animations.filter(name => name !== 'walk')])]
    .map(id => ({ id, label: labels[id] ?? id }));
}
