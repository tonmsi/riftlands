import type { Actor } from '../shared/types';
import { randomUUID } from '../shared/id';
import { hasLineOfSight, collidesWorld } from '../shared/physics';
import type { World } from '../shared/world';
import type { Account } from './store';
import { insertItem, newInventory } from '../shared/items';
import { acceptQuest, advanceQuest, conditionMatches, DIALOGUE_DEFINITIONS, QUEST_DEFINITIONS, newNarrativeProgress, questStatus, questReward, questCompletions } from '../shared/narrative';
import { NPC_LOOT_TABLES } from '../shared/loot';
import { GROUND_ITEM_TTL, INTERACTION_RANGE, type GroundItem, type DialogueView, type InteractionCommand } from '../shared/interactions';

interface Host {
  players: ReadonlyMap<string, Actor>; npcs: ReadonlyMap<string, Actor>; accounts: ReadonlyMap<string, Account>; world: World;
  connected: (id: string) => boolean; combatAt: (id: string) => number; changed: (id: string) => void;
  nearbyPlayers: (point: { x: number; y: number }, radius: number) => Actor[];
  rewardXp: (id: string, amount: number) => void;
}
interface Session { id: string; targetId: string; dialogueId: string; node: string; startedAt: number; expiresAt: number; }
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** Server-owned sessions and transactions; content contains conditions/actions, never executable script. */
export class InteractionSystem {
  readonly drops = new Map<string, GroundItem>();
  private sessions = new Map<string, Session>();
  constructor(private host: Host, private random = Math.random) {}
  private account(id: string): Account {
    const account = this.host.accounts.get(id);
    if (!account) throw new Error('Personaggio non disponibile.');
    account.inventory ??= newInventory(); account.narrative ??= newNarrativeProgress(); return account;
  }
  private target(id: string, targetId: string): Actor {
    const player = this.host.players.get(id), target = this.host.npcs.get(targetId);
    if (!player || !this.host.connected(id) || player.hp <= 0 || !target || target.hp <= 0 || !target.dialogueId
      || distance(player, target) > INTERACTION_RANGE || !hasLineOfSight(player, target, this.host.world)) throw new Error('Avvicinati al personaggio per parlare.');
    return target;
  }
  private session(id: string, sessionId: string, now: number): Session {
    const session = this.sessions.get(id);
    if (!session || session.id !== sessionId || now >= session.expiresAt || this.host.combatAt(id) > session.startedAt) throw new Error('La conversazione è terminata.');
    this.target(id, session.targetId); return session;
  }
  private advance(session: Session, node: string, now: number): void { session.node = node; session.id = randomUUID(); session.expiresAt = now + 120_000; }
  command(id: string, command: InteractionCommand, now: number): void {
    const account = this.account(id);
    if (command.kind === 'talk') {
      const target = this.target(id, command.targetId), dialogue = DIALOGUE_DEFINITIONS[target.dialogueId!];
      if (!dialogue) throw new Error('Questo personaggio non ha ancora un dialogo.');
      const node = dialogue.entries.find(entry => conditionMatches(account.narrative!, entry.condition, now))?.node;
      if (!node) throw new Error('Nessuna conversazione disponibile.');
      this.sessions.set(id, { id: randomUUID(), targetId: target.id, dialogueId: dialogue.id, node, startedAt: now, expiresAt: now + 120_000 }); return;
    }
    if (command.kind === 'drop-item') { this.drop(id, command.slot, command.itemId, command.quantity, now); return; }
    if (command.kind === 'close') { if (this.sessions.get(id)?.id === command.sessionId) this.sessions.delete(id); return; }
    const session = this.session(id, command.sessionId, now), dialogue = DIALOGUE_DEFINITIONS[session.dialogueId], node = dialogue.nodes[session.node];
    if (command.kind === 'choose') {
      const choice = node.choices.find(choice => choice.id === command.choiceId && (!choice.condition || conditionMatches(account.narrative!, choice.condition, now)));
      if (!choice) throw new Error('Questa risposta non è più disponibile.');
      if (choice.action?.kind === 'accept-quest') {
        const quest = QUEST_DEFINITIONS[choice.action.questId];
        if (!quest) throw new Error('Missione non disponibile.');
        acceptQuest(account.narrative!, quest, now); this.host.changed(id);
      }
      if (choice.next) this.advance(session, choice.next, now); else this.sessions.delete(id);
      return;
    }
    // A requested item is consumed through the same interaction path future objects/portals can use.
    const quest = node.itemRequest ? QUEST_DEFINITIONS[node.itemRequest.questId] : undefined;
    const stack = account.inventory!.slots[command.slot];
    if (!quest || questStatus(account.narrative!, quest.id, now) !== 'active' || !stack || stack.itemId !== command.itemId || stack.itemId !== quest.objective.itemId) throw new Error('Questo oggetto non è richiesto qui.');
    const progress = account.narrative!.quests[quest.id], delivered = progress.objectives[quest.objective.id] ?? 0;
    const consumed = Math.min(stack.quantity, quest.objective.quantity - delivered);
    if (consumed <= 0) throw new Error('Consegna già completata.');
    stack.quantity -= consumed; if (!stack.quantity) account.inventory!.slots[command.slot] = null;
    const previousCompletions = questCompletions(progress);
    advanceQuest(account.narrative!, quest, consumed, now);
    if (progress.status === 'completed') {
      const reward = questReward(quest, previousCompletions);
      account.gold = (account.gold ?? 0) + reward.gold;
      this.host.rewardXp(id, reward.xp);
    }
    this.advance(session, progress.status === 'completed' ? node.itemRequest!.completedNext : node.itemRequest!.progressNext, now); this.host.changed(id);
  }
  view(id: string, now: number): DialogueView | null {
    const session = this.sessions.get(id); if (!session) return null;
    try { this.session(id, session.id, now); } catch { this.sessions.delete(id); return null; }
    const account = this.account(id), dialogue = DIALOGUE_DEFINITIONS[session.dialogueId], node = dialogue.nodes[session.node];
    const quest = node.itemRequest ? QUEST_DEFINITIONS[node.itemRequest.questId] : undefined;
    const remaining = quest ? Math.max(0, quest.objective.quantity - (account.narrative!.quests[quest.id]?.objectives[quest.objective.id] ?? 0)) : 0;
    return { sessionId: session.id, targetId: session.targetId, speaker: this.host.npcs.get(session.targetId)!.name, text: node.text.replace('{remaining}', String(remaining)),
      choices: node.choices.filter(choice => !choice.condition || conditionMatches(account.narrative!, choice.condition, now)).map(({ id, label }) => ({ id, label })),
      ...(quest && remaining ? { request: { itemId: quest.objective.itemId, remaining } } : {}) };
  }
  marker(id: string, dialogueId: string, now: number): Actor['questMarker'] {
    const dialogue = DIALOGUE_DEFINITIONS[dialogueId]; return dialogue ? questStatus(this.account(id).narrative!, dialogue.questId, now) : undefined;
  }
  killed(victim: Actor, killer: Actor | undefined, now: number): void {
    if (killer?.kind !== 'player' || !this.host.connected(killer.id)) return;
    const account = this.account(killer.id);
    for (const rule of NPC_LOOT_TABLES[victim.npcKind ?? ''] ?? []) {
      if (rule.condition && !conditionMatches(account.narrative!, rule.condition, now) || this.random() >= rule.chance) continue;
      if (this.drops.size >= 2048) return;
      const drop: GroundItem = { id: randomUUID(), x: victim.x, y: victim.y, stack: { itemId: rule.itemId, quantity: rule.quantity }, expiresAt: now + GROUND_ITEM_TTL, ownerId: killer.id };
      this.drops.set(drop.id, drop);
    }
  }
  private drop(id: string, slot: number, itemId: string, quantity: number, now: number): void {
    const player = this.host.players.get(id), account = this.account(id), stack = account.inventory!.slots[slot];
    if (!this.host.connected(id) || !player || player.hp <= 0 || !stack || stack.itemId !== itemId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > stack.quantity) throw new Error('Oggetto o quantità non disponibile.');
    if (this.drops.size >= 2048) throw new Error('Troppi oggetti a terra. Attendi qualche secondo.');
    let point = { x: player.x, y: player.y };
    for (let i = 0; i < 12; i++) {
      const angle = player.aim + i * Math.PI / 6, candidate = { x: player.x + Math.cos(angle) * 42, y: player.y + Math.sin(angle) * 42 };
      if (!collidesWorld(candidate.x, candidate.y, 10, this.host.world) && hasLineOfSight(player, candidate, this.host.world)) { point = candidate; break; }
    }
    const drop: GroundItem = { id: randomUUID(), ...point, stack: { itemId, quantity }, expiresAt: now + GROUND_ITEM_TTL, droppedBy: id, ownerPickupAt: now + 1000 };
    stack.quantity -= quantity; if (!stack.quantity) account.inventory!.slots[slot] = null;
    this.drops.set(drop.id, drop); this.host.changed(id);
  }
  step(now: number): void {
    for (const [id, drop] of this.drops) {
      if (now >= drop.expiresAt) { this.drops.delete(id); continue; }
      for (const player of this.host.nearbyPlayers(drop, 64)) {
        if (!this.host.connected(player.id) || player.hp <= 0 || drop.ownerId && drop.ownerId !== player.id
          || drop.droppedBy === player.id && now < (drop.ownerPickupAt ?? 0) || distance(player, drop) > player.radius + 10 || !hasLineOfSight(player, drop, this.host.world)) continue;
        if (!insertItem(this.account(player.id).inventory!, drop.stack.itemId, drop.stack.quantity)) continue;
        this.drops.delete(id); this.host.changed(player.id); break;
      }
    }
    for (const id of this.sessions.keys()) this.view(id, now);
  }
  visibleDrops(id: string, now: number, radius: number): GroundItem[] {
    const player = this.host.players.get(id); if (!player) return [];
    return [...this.drops.values()].filter(drop => drop.expiresAt > now && (!drop.ownerId || drop.ownerId === id) && distance(player, drop) < radius).map(drop => ({ ...drop, stack: { ...drop.stack } }));
  }
  close(id: string): void { this.sessions.delete(id); }
}
