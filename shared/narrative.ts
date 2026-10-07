export interface QuestProgress { status: 'active' | 'completed'; objectives: Record<string, number>; completions?: number; completedAt?: number; }
export interface NarrativeProgress { version: 1; quests: Record<string, QuestProgress>; revision?: number; gifts?: string[]; flags?: string[]; }
export const newNarrativeProgress = (): NarrativeProgress => ({ version: 1, quests: {} });
export type NarrativeCondition = { kind: 'quest-status'; questId: string; status: 'available' | 'active' | 'completed' } | { kind: 'quest-completed'; questId: string } | { kind: 'flag'; id: string; value: boolean } | { kind: 'gift-unclaimed'; id: string };
export type NarrativeAction = { kind: 'accept-quest'; questId: string } | { kind: 'give-item'; itemId: string; giftId: string };
export type QuestObjective = { kind?: 'deliver-item'; id: string; itemId: string; quantity: number }
  | { kind: 'reach-area'; id: string; quantity: 1; description: string };
export interface QuestDefinition { id: string; name: string; requiresQuest?: string; repeatable?: boolean; repeatAfterMs?: number; reward?: { xp: number; minXp: number; firstGold: number; items?: readonly { itemId: string; quantity: number; firstOnly?: boolean; toInventory?: boolean; giftId?: string }[] }; objective: QuestObjective; }
export interface DialogueChoice { id: string; label: string; next?: string; action?: NarrativeAction; condition?: NarrativeCondition; }
export interface DialogueNode { text: string; choices: readonly DialogueChoice[]; itemRequest?: { questId: string; completedNext: string; progressNext: string }; rewardQuestId?: string; }
export interface DialogueDefinition { id: string; questId: string; onTalkFlag?: string; showQuestMarker?: boolean; questMarkerCondition?: NarrativeCondition; entries: readonly { condition: NarrativeCondition; node: string }[]; nodes: Readonly<Record<string, DialogueNode>>; }
export const QUEST_DEFINITIONS: Readonly<Record<string, QuestDefinition>> = {
  'find-platos': { id: 'find-platos', name: 'Ascolta il vecchio', reward: { xp: 150, minXp: 150, firstGold: 0 },
    objective: { kind: 'reach-area', id: 'platos-reached', quantity: 1, description: 'Raggiungi Platos a nord. Il viaggio è lungo: porta provviste. Non occorre combattere.' } },
  'north-road': { id: 'north-road', name: 'Pietre che camminano',
    reward: { xp: 100, minXp: 100, firstGold: 0 },
    objective: { kind: 'reach-area', id: 'road-reached', quantity: 1, description: 'Raggiungi la strada a nord. Non occorre combattere i guardiani.' } },
  'stinking-bait': { id: 'stinking-bait', name: 'Esche puzzolenti', repeatable: true, repeatAfterMs: 5 * 60 * 1000, reward: { xp: 150, minXp: 5, firstGold: 20, items: [{ itemId: 'backpack-2', quantity: 1, firstOnly: true }, { itemId: 'fishing-rod', quantity: 1, firstOnly: true, toInventory: true, giftId: 'nereo-first-rod' }] }, objective: { id: 'innards-delivered', itemId: 'slime-innards', quantity: 3 } },
};
const questCondition = (status: 'available' | 'active' | 'completed'): NarrativeCondition => ({ kind: 'quest-status', questId: 'stinking-bait', status });
export const DIALOGUE_DEFINITIONS: Readonly<Record<string, DialogueDefinition>> = {
  'wounded-scout': {
    id: 'wounded-scout', questId: 'find-platos', questMarkerCondition: { kind: 'flag', id: 'met-platos', value: false },
    entries: [
      { condition: { kind: 'flag', id: 'met-platos', value: true }, node: 'wounded' },
      { condition: { kind: 'quest-status', questId: 'find-platos', status: 'completed' }, node: 'wounded' },
      { condition: { kind: 'quest-status', questId: 'find-platos', status: 'active' }, node: 'active' },
      { condition: { kind: 'quest-status', questId: 'find-platos', status: 'available' }, node: 'intro' },
    ],
    nodes: {
      intro: { text: 'Vengo da nord. Quelle cose mi hanno quasi spezzato una gamba. Il vecchio Platos ci aveva avvertiti di non passare… e io non gli ho dato retta.', choices: [
        { id: 'platos', label: 'Chi è Platos?', next: 'advice' }, { id: 'leave', label: 'Riposa. Devo andare.' },
      ] },
      advice: { text: 'Un vecchio che ricorda cose che noi preferiamo dimenticare. Se vuoi capire cosa sta succedendo, raggiungilo. Ti segno il posto sulla mappa. La strada è tortuosa e il viaggio è lungo: portati delle provviste. Non fare il mio stesso errore.', choices: [
        { id: 'accept', label: 'Andrò da Platos.', next: 'accepted', action: { kind: 'accept-quest', questId: 'find-platos' }, condition: { kind: 'flag', id: 'met-platos', value: false } },
        { id: 'leave', label: 'Terrò a mente il consiglio.' },
      ] },
      accepted: { text: 'Prenditi il tempo di prepararti. Platos è più a nord, lontano da questa strada. Se una roccia si muove, girale al largo.', choices: [{ id: 'leave', label: 'Farò attenzione.' }] },
      active: { text: 'Hai già la strada per Platos segnata sulla mappa. Portati provviste… io ho pensato di potermela cavare senza ascoltare nessuno.', choices: [{ id: 'leave', label: 'Riposa.' }] },
      wounded: { text: 'Vengo da nord. Sono stato ferito sulla strada. Ora devo solo recuperare le forze.', choices: [{ id: 'leave', label: 'Ti lascio riposare.' }] },
    },
  },
  platos: {
    id: 'platos', questId: 'find-platos', onTalkFlag: 'met-platos', showQuestMarker: false,
    entries: [{ condition: { kind: 'flag', id: 'met-platos', value: true }, node: 'intro' }],
    nodes: {
      intro: { text: 'Una Leggenda fin quassù. Qualcuno ti ha mandato, oppure sai ancora seguire la tua curiosità?', choices: [
        { id: 'stones', label: 'Ho visto delle rocce muoversi.', next: 'stones' },
        { id: 'north', label: 'Che cosa succede a nord?', next: 'north' }, { id: 'leave', label: 'Ripasserò.' },
      ] },
      stones: { text: 'Quando ero bambino, ci dicevano di non disturbare le pietre delle montagne. Nelle storie, i loro custodi avevano un nome: Warden. Non so se quelli che hai visto siano proprio loro… ma adesso ascolterei quelle storie.', choices: [{ id: 'north', label: 'E a nord?', next: 'north' }, { id: 'leave', label: 'Devo pensarci.' }] },
      north: { text: 'Qualcosa ha interrotto il passaggio. Da allora le creature scendono verso sud e le pattuglie non tornano. Non ho risposte per tutto. Ho soltanto memoria… e qualche avvertimento che nessuno ha voluto ascoltare.', choices: [{ id: 'leave', label: 'Io ti ascolterò.' }] },
    },
  },
  'north-scout': {
    id: 'north-scout', questId: 'north-road',
    entries: [
      { condition: { kind: 'quest-status', questId: 'north-road', status: 'completed' }, node: 'after' },
      { condition: { kind: 'quest-status', questId: 'north-road', status: 'active' }, node: 'active' },
      { condition: { kind: 'quest-completed', questId: 'stinking-bait' }, node: 'intro' },
      { condition: { kind: 'quest-status', questId: 'north-road', status: 'available' }, node: 'independent' },
    ],
    nodes: {
      independent: { text: 'Un’altra Leggenda. Se vuoi renderti utile, guarda la strada a nord. Ci sono uomini che non sono tornati e rocce che si muovono. Vai a vedere, ma non ti ho chiesto di fare l’eroe.', choices: [
        { id: 'accept', label: 'Andrò a vedere.', next: 'accepted', action: { kind: 'accept-quest', questId: 'north-road' } }, { id: 'leave', label: 'Non adesso.' },
      ] },
      intro: { text: 'Nereo dice che sai renderti utile. Vediamo. Sulla strada a nord ci sono uomini che non sono tornati. E quelle che sembrano rocce… si muovono. Vai a vedere con i tuoi occhi. Non devi affrontarle: resta vivo, per una volta.', choices: [
        { id: 'accept', label: 'Andrò a vedere.', next: 'accepted', action: { kind: 'accept-quest', questId: 'north-road' } },
        { id: 'leave', label: 'Non adesso.' },
      ] },
      accepted: { text: 'Segui la strada verso nord. Ti ho segnato il tratto sulla mappa. Basta arrivarci: non portarmi trofei e non farti ammazzare per impressionarmi.', choices: [{ id: 'leave', label: 'Ho capito.' }] },
      active: { text: 'La strada è a nord, dove ti ho indicato. Guarda quei corpi e quelle pietre. Non ti ho chiesto di combattere.', choices: [{ id: 'leave', label: 'Vado.' }] },
      after: { text: 'Adesso capisci perché sorvegliamo la strada. Non erano semplici rocce. Sei ancora vivo… bene. Forse sai anche ascoltare.', choices: [{ id: 'leave', label: 'Quelle cose da dove arrivano?' , next: 'mystery' }] },
      mystery: { text: 'Da più a nord. Oltre quel tratto non sappiamo più cosa succeda. Per ora tieni gli occhi aperti.', choices: [{ id: 'leave', label: 'Lo farò.' }] },
    },
  },
  'old-fisher': {
    id: 'old-fisher', questId: 'stinking-bait',
    entries: [{ condition: questCondition('completed'), node: 'after' }, { condition: questCondition('active'), node: 'delivery' }, { condition: questCondition('available'), node: 'intro' }],
    nodes: {
      intro: { text: 'Per le mie esche puzzolenti servono tre interiora di gelatina. Una volta me le procuravo da solo… adesso sono troppo vecchio. E dopo quello che è successo… Be’, lasciamo stare. Mi daresti una mano?', choices: [
        { id: 'accept', label: 'Ti porterò le interiora.', next: 'accepted', action: { kind: 'accept-quest', questId: 'stinking-bait' }, condition: questCondition('available') },
        { id: 'event', label: 'Che cosa è successo?', next: 'event' }, { id: 'leave', label: 'Forse un’altra volta.' },
      ] },
      event: { text: 'Certi rumori non te li togli più dalle orecchie. E certe persone non tornano. Non oggi, ragazzo… non chiedermi di parlarne oggi.', choices: [{ id: 'back', label: 'Capisco. Torniamo alle esche.', next: 'intro' }] },
      accepted: { text: 'Grazie. Cerca le gelatine e raccogli quello che lasciano. Quando torni, mostrami le interiora dalla tua sacca. Me ne bastano tre.', choices: [{ id: 'leave', label: 'A presto, Nereo.' }] },
      delivery: { text: 'Hai qualcosa per me? Premi sulle interiora nella tua sacca: ne prenderò soltanto quante me ne mancano. Me ne servono ancora {remaining}.', itemRequest: { questId: 'stinking-bait', completedNext: 'thanks', progressNext: 'delivery' }, choices: [{ id: 'event', label: 'Di quell’evento…', next: 'event-active' }, { id: 'leave', label: 'Torno presto.' }] },
      'event-active': { text: 'Da quella notte il mondo ha un altro odore. Le mie esche almeno le so riconoscere… Il resto, meno. Perdona questo vecchio.', choices: [{ id: 'back', label: 'Hai bisogno delle interiora.', next: 'delivery' }] },
      thanks: { text: 'Eccole! Questo sì che è un fetore come si deve. Con queste preparo le mie esche. Grazie, ragazzo. Le altre tienile tu. {rewardDelivery} Tra cinque minuti avrò bisogno di nuove esche.', rewardQuestId: 'stinking-bait', choices: [{ id: 'leave', label: 'Buona pesca.', next: 'bad-luck' }] },
      'bad-luck': { text: 'Buona pesca?! Ti maledico, ragazzo! Che tutte le gelatine del pantano ti si appiccichino agli stivali! Ai pescatori non si augura mai buona pesca… porta sfortuna!', choices: [{ id: 'leave', label: 'Mi rimangio l’augurio!' }] },
      after: { text: 'Le tue esche funzionano. Sono contento di rivederti: siediti, se hai un momento. Per ora non ho bisogno di altre interiora. Ripassa cinque minuti dopo la tua ultima consegna.', choices: [{ id: 'event', label: 'Come stai?', next: 'after-chat' }, { id: 'leave', label: 'Passavo a salutarti.' }] },
      'after-chat': { text: 'Le ginocchia scricchiolano e i ricordi fanno peggio. Ma finché c’è qualcuno che passa a salutare, posso aspettare un’altra alba.', choices: [{ id: 'leave', label: 'Ci vediamo, Nereo.' }] },
    },
  },
};
/** Cooldowns use persisted server timestamps, so offline time counts as well. */
function cooldownElapsed(current: QuestProgress, quest: QuestDefinition, now: number): boolean {
  return current.completedAt === undefined || now >= current.completedAt + (quest.repeatAfterMs ?? 0);
}
export function questStatus(progress: NarrativeProgress, id: string, now = Date.now()): 'available' | 'active' | 'completed' {
  const current = progress.quests[id], quest = QUEST_DEFINITIONS[id];
  if (current?.status === 'completed' && quest?.repeatable && quest.repeatAfterMs !== undefined && cooldownElapsed(current, quest, now)) return 'available';
  return current?.status ?? 'available';
}
export function conditionMatches(progress: NarrativeProgress, condition: NarrativeCondition, now = Date.now()): boolean {
  if (condition.kind === 'flag') return !!progress.flags?.includes(condition.id) === condition.value;
  if (condition.kind === 'gift-unclaimed') return !progress.gifts?.includes(condition.id);
  if (condition.kind === 'quest-completed') return !!progress.quests[condition.questId] && questCompletions(progress.quests[condition.questId]) > 0;
  return questStatus(progress, condition.questId, now) === condition.status;
}
/** Legacy completed missions count once, without requiring an account reset. */
export function questCompletions(quest: QuestProgress): number { return quest.completions ?? (quest.status === 'completed' ? 1 : 0); }
export function questReward(quest: QuestDefinition, previousCompletions: number): { xp: number; gold: number } {
  if (!quest.reward) return { xp: 0, gold: 0 };
  return { xp: Math.max(quest.reward.minXp, Math.floor(quest.reward.xp / 2 ** Math.min(30, previousCompletions))), gold: previousCompletions === 0 ? quest.reward.firstGold : 0 };
}
export function acceptQuest(progress: NarrativeProgress, quest: QuestDefinition, now = Date.now()): void {
  if (quest.requiresQuest && !conditionMatches(progress, { kind: 'quest-completed', questId: quest.requiresQuest }, now)) throw new Error('Completa prima la missione precedente.');
  const previous = progress.quests[quest.id];
  if (previous && (previous.status === 'active' || !quest.repeatable || !cooldownElapsed(previous, quest, now))) throw new Error('Missione già accettata o conclusa.');
  progress.quests[quest.id] = { status: 'active', objectives: {}, completions: previous ? questCompletions(previous) : 0 };
  progress.revision = (progress.revision ?? 0) + 1;
}
export function advanceQuest(progress: NarrativeProgress, quest: QuestDefinition, amount: number, now = Date.now()): void {
  const current = progress.quests[quest.id];
  if (!current || current.status !== 'active' || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('Progresso missione non valido.');
  current.objectives[quest.objective.id] = Math.min(quest.objective.quantity, (current.objectives[quest.objective.id] ?? 0) + amount);
  if (current.objectives[quest.objective.id] >= quest.objective.quantity) {
    current.completions = questCompletions(current) + 1;
    current.status = 'completed';
    current.completedAt = Math.floor(now);
  }
  progress.revision = (progress.revision ?? 0) + 1;
}
export function validNarrativeProgress(value: unknown): value is NarrativeProgress {
  const progress = value as NarrativeProgress;
  const id = (text: string) => /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(text);
  return !!progress && progress.version === 1 && !!progress.quests && typeof progress.quests === 'object' && !Array.isArray(progress.quests)
    && (progress.gifts === undefined || Array.isArray(progress.gifts) && progress.gifts.length <= 512 && progress.gifts.every(gift => typeof gift === 'string' && id(gift)))
    && (progress.flags === undefined || Array.isArray(progress.flags) && progress.flags.length <= 512 && progress.flags.every(flag => typeof flag === 'string' && id(flag)))
    && (progress.revision === undefined || Number.isSafeInteger(progress.revision) && progress.revision >= 0)
    && Object.keys(progress.quests).length <= 512 && Object.entries(progress.quests).every(([key, quest]) => id(key) && !!quest
      && (quest.completions === undefined || Number.isSafeInteger(quest.completions) && quest.completions >= 0 && quest.completions <= 1_000_000)
      && (quest.completedAt === undefined || Number.isSafeInteger(quest.completedAt) && quest.completedAt >= 0)
      && ['active', 'completed'].includes(quest.status) && !!quest.objectives && typeof quest.objectives === 'object' && !Array.isArray(quest.objectives)
      && Object.keys(quest.objectives).length <= 32 && Object.entries(quest.objectives).every(([key, count]) => id(key) && Number.isSafeInteger(count) && count >= 0 && count <= 1_000_000));
}
