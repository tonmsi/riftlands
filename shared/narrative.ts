export interface QuestProgress { status: 'active' | 'completed'; objectives: Record<string, number>; completions?: number; completedAt?: number; }
export interface NarrativeProgress { version: 1; quests: Record<string, QuestProgress>; revision?: number; gifts?: string[]; }
export const newNarrativeProgress = (): NarrativeProgress => ({ version: 1, quests: {} });
export type NarrativeCondition = { kind: 'quest-status'; questId: string; status: 'available' | 'active' | 'completed' } | { kind: 'gift-unclaimed'; id: string };
export type NarrativeAction = { kind: 'accept-quest'; questId: string } | { kind: 'give-item'; itemId: string; giftId: string };
export interface QuestDefinition { id: string; name: string; repeatable?: boolean; repeatAfterMs?: number; reward?: { xp: number; minXp: number; firstGold: number; items?: readonly { itemId: string; quantity: number; firstOnly?: boolean }[] }; objective: { id: string; itemId: string; quantity: number }; }
export interface DialogueChoice { id: string; label: string; next?: string; action?: NarrativeAction; condition?: NarrativeCondition; }
export interface DialogueNode { text: string; choices: readonly DialogueChoice[]; itemRequest?: { questId: string; completedNext: string; progressNext: string }; rewardQuestId?: string; }
export interface DialogueDefinition { id: string; questId: string; entries: readonly { condition: NarrativeCondition; node: string }[]; nodes: Readonly<Record<string, DialogueNode>>; }
export const QUEST_DEFINITIONS: Readonly<Record<string, QuestDefinition>> = {
  'stinking-bait': { id: 'stinking-bait', name: 'Esche puzzolenti', repeatable: true, repeatAfterMs: 5 * 60 * 1000, reward: { xp: 150, minXp: 5, firstGold: 20, items: [{ itemId: 'backpack-2', quantity: 1, firstOnly: true }, { itemId: 'healing-potion', quantity: 1 }] }, objective: { id: 'innards-delivered', itemId: 'slime-innards', quantity: 3 } },
};
const questCondition = (status: 'available' | 'active' | 'completed'): NarrativeCondition => ({ kind: 'quest-status', questId: 'stinking-bait', status });
const fishingChoice: DialogueChoice = { id: 'fishing', label: 'Vorrei imparare a pescare.', next: 'fishing', condition: { kind: 'gift-unclaimed', id: 'nereo-first-rod' }, action: { kind: 'give-item', itemId: 'fishing-rod', giftId: 'nereo-first-rod' } };
export const DIALOGUE_DEFINITIONS: Readonly<Record<string, DialogueDefinition>> = {
  'old-fisher': {
    id: 'old-fisher', questId: 'stinking-bait',
    entries: [{ condition: questCondition('completed'), node: 'after' }, { condition: questCondition('active'), node: 'delivery' }, { condition: questCondition('available'), node: 'intro' }],
    nodes: {
      intro: { text: 'Per le mie esche puzzolenti servono tre interiora di gelatina. Una volta me le procuravo da solo… adesso sono troppo vecchio. E dopo quello che è successo… Be’, lasciamo stare. Mi daresti una mano?', choices: [
        fishingChoice,
        { id: 'accept', label: 'Ti porterò le interiora.', next: 'accepted', action: { kind: 'accept-quest', questId: 'stinking-bait' }, condition: questCondition('available') },
        { id: 'event', label: 'Che cosa è successo?', next: 'event' }, { id: 'leave', label: 'Forse un’altra volta.' },
      ] },
      event: { text: 'Certi rumori non te li togli più dalle orecchie. E certe persone non tornano. Non oggi, ragazzo… non chiedermi di parlarne oggi.', choices: [{ id: 'back', label: 'Capisco. Torniamo alle esche.', next: 'intro' }] },
      accepted: { text: 'Grazie. Cerca le gelatine e raccogli quello che lasciano. Quando torni, mostrami le interiora dalla tua sacca. Me ne bastano tre.', choices: [{ id: 'leave', label: 'A presto, Nereo.' }] },
      delivery: { text: 'Hai qualcosa per me? Premi sulle interiora nella tua sacca: ne prenderò soltanto quante me ne mancano. Me ne servono ancora {remaining}.', itemRequest: { questId: 'stinking-bait', completedNext: 'thanks', progressNext: 'delivery' }, choices: [fishingChoice, { id: 'event', label: 'Di quell’evento…', next: 'event-active' }, { id: 'leave', label: 'Torno presto.' }] },
      fishing: { text: 'Questa canna è tua: l’ho lasciata qui a terra, soltanto per te. Raccoglila e usala vicino alla riva. Monta un’esca dalla sacca, oppure una moneta: i predatori amano i riflessi! Punta nell’acqua e lancia. Non sempre abboccano. Quando succede ferra subito, poi tira e rilascia: troppo molle si slama, troppo teso si spezza. Se manchi la ferrata o perdi il pesce, perdi anche l’esca. Le monete tornano con la cattura. Se perdi la canna, Ada ne vende altre.', choices: [{ id: 'leave', label: 'Vado alla riva.' }] },
      'event-active': { text: 'Da quella notte il mondo ha un altro odore. Le mie esche almeno le so riconoscere… Il resto, meno. Perdona questo vecchio.', choices: [{ id: 'back', label: 'Hai bisogno delle interiora.', next: 'delivery' }] },
      thanks: { text: 'Eccole! Questo sì che è un fetore come si deve. Con queste preparo le mie esche. Grazie, ragazzo. Le altre tienile tu. Ho lasciato la tua ricompensa qui a terra: raccoglila prima di andare. La vedrai soltanto tu! Tra cinque minuti avrò bisogno di nuove esche.', rewardQuestId: 'stinking-bait', choices: [{ id: 'leave', label: 'Buona pesca.', next: 'bad-luck' }] },
      'bad-luck': { text: 'Buona pesca?! Ti maledico, ragazzo! Che tutte le gelatine del pantano ti si appiccichino agli stivali! Ai pescatori non si augura mai buona pesca… porta sfortuna!', choices: [{ id: 'leave', label: 'Mi rimangio l’augurio!' }] },
      after: { text: 'Le tue esche funzionano. Sono contento di rivederti: siediti, se hai un momento. Per ora non ho bisogno di altre interiora. Ripassa cinque minuti dopo la tua ultima consegna.', choices: [fishingChoice, { id: 'event', label: 'Come stai?', next: 'after-chat' }, { id: 'leave', label: 'Passavo a salutarti.' }] },
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
export function conditionMatches(progress: NarrativeProgress, condition: NarrativeCondition, now = Date.now()): boolean { return condition.kind === 'gift-unclaimed' ? !progress.gifts?.includes(condition.id) : questStatus(progress, condition.questId, now) === condition.status; }
/** Legacy completed missions count once, without requiring an account reset. */
export function questCompletions(quest: QuestProgress): number { return quest.completions ?? (quest.status === 'completed' ? 1 : 0); }
export function questReward(quest: QuestDefinition, previousCompletions: number): { xp: number; gold: number } {
  if (!quest.reward) return { xp: 0, gold: 0 };
  return { xp: Math.max(quest.reward.minXp, Math.floor(quest.reward.xp / 2 ** Math.min(30, previousCompletions))), gold: previousCompletions === 0 ? quest.reward.firstGold : 0 };
}
export function acceptQuest(progress: NarrativeProgress, quest: QuestDefinition, now = Date.now()): void {
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
    && (progress.revision === undefined || Number.isSafeInteger(progress.revision) && progress.revision >= 0)
    && Object.keys(progress.quests).length <= 512 && Object.entries(progress.quests).every(([key, quest]) => id(key) && !!quest
      && (quest.completions === undefined || Number.isSafeInteger(quest.completions) && quest.completions >= 0 && quest.completions <= 1_000_000)
      && (quest.completedAt === undefined || Number.isSafeInteger(quest.completedAt) && quest.completedAt >= 0)
      && ['active', 'completed'].includes(quest.status) && !!quest.objectives && typeof quest.objectives === 'object' && !Array.isArray(quest.objectives)
      && Object.keys(quest.objectives).length <= 32 && Object.entries(quest.objectives).every(([key, count]) => id(key) && Number.isSafeInteger(count) && count >= 0 && count <= 1_000_000));
}
