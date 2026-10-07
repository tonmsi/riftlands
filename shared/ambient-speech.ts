import type { NpcTemplateId } from './npcs';

export interface AmbientSpeechDefinition { intro: string; lines: readonly string[]; }
/** Personal flavour only: never changes quests, rewards or reputation. */
export const AMBIENT_SPEECH: Partial<Record<NpcTemplateId, AmbientSpeechDefinition>> = {
  'north-scout': { intro: 'Un’altra Leggenda. Vediamo quanto duri.', lines: ['Non tutte le rocce restano ferme.', 'Guarda dove metti i piedi.'] },
  'dock-skeptic': {
    intro: 'Ah, un’altra “Leggenda”. Tornatene dai tuoi amici. Qui non vi vogliamo.',
    lines: [
      'Quelli prima di te erano bravissimi… a chiedere gold.',
      'Il titolo ce l’hai. Adesso vediamo se sai fare qualcosa.',
      'Le bestie arrivano da nord. Le vostre promesse, da ogni parte.',
      'Se cerchi applausi, prova in un altro porto.',
    ],
  },
  'old-fisher': {
    intro: 'Ehi, tu. Hai un momento per un vecchio pescatore?',
    lines: ['Da quella notte, anche il mare sembra diverso.', 'Oggi le ginocchia non ne vogliono sapere.'],
  },
  'outpost-vendor': {
    intro: 'Dai un’occhiata. Viaggiare con la sacca piena non conviene a nessuno.',
    lines: ['Le provviste finiscono sempre nel momento peggiore.', 'Verso nord? Meglio partire preparati.'],
  },
};
