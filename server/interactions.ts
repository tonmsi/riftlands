import type { Actor } from '../shared/types';
import { randomUUID } from '../shared/id';
import { hasLineOfSight, collidesWorld } from '../shared/physics';
import type { World } from '../shared/world';
import type { Account } from './store';
import { canCollectItem, collectItem, ITEM_DEFINITIONS, newInventory, type ItemStack } from '../shared/items';
import { VENDOR_DEFINITIONS, type VendorOffer } from '../shared/vendors';
import { acceptQuest, advanceQuest, conditionMatches, DIALOGUE_DEFINITIONS, QUEST_DEFINITIONS, newNarrativeProgress, questStatus, questReward, questCompletions } from '../shared/narrative';
import { NPC_LOOT_TABLES } from '../shared/loot';
import { GROUND_ITEM_TTL, LOOT_ITEM_TTL, INTERACTION_RANGE, type GroundItem, type DialogueView, type InteractionCommand, type InventoryAction } from '../shared/interactions';

interface Host {
  players: ReadonlyMap<string, Actor>; npcs: ReadonlyMap<string, Actor>; accounts: ReadonlyMap<string, Account>; world: World;
  connected: (id: string) => boolean; combatAt: (id: string) => number; changed: (id: string) => void;
  nearbyPlayers: (point: { x: number; y: number }, radius: number) => Actor[];
  rewardXp: (id: string, amount: number) => void;
  heal: (player: Actor, amount: number) => void;
}
interface Session { id: string; targetId: string; dialogueId: string; node: string; startedAt: number; expiresAt: number; }
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** Server-owned sessions and transactions; content contains conditions/actions, never executable script. */
export class InteractionSystem {
  readonly drops = new Map<string, GroundItem>();
  private sessions = new Map<string, Session>();
  private consumableReadyAt = new Map<string, number>();
  private inventoryActions = new Map<string, InventoryAction[]>();
  private action(id: string, kind: InventoryAction['kind'], stack: ItemStack, now: number, slot?: number): void {
    const recent = this.feedback(id, now);
    recent.push({ id: randomUUID(), kind, itemId: stack.itemId, quantity: stack.quantity, at: now, slot });
    this.inventoryActions.set(id, recent.slice(-12));
  }
  feedback(id: string, now: number): InventoryAction[] { return (this.inventoryActions.get(id) ?? []).filter(action => now - action.at < 2500).map(action => ({ ...action })); }
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
      const target = this.target(id, command.targetId), vendor = VENDOR_DEFINITIONS[target.dialogueId!];
      if (vendor) {
        this.sessions.set(id, { id: randomUUID(), targetId: target.id, dialogueId: vendor.id, node: 'shop', startedAt: now, expiresAt: now + 120_000 }); return;
      }
      const dialogue = DIALOGUE_DEFINITIONS[target.dialogueId!];
      if (!dialogue) throw new Error('Questo personaggio non ha ancora un dialogo.');
      const node = dialogue.entries.find(entry => conditionMatches(account.narrative!, entry.condition, now))?.node;
      if (!node) throw new Error('Nessuna conversazione disponibile.');
      this.sessions.set(id, { id: randomUUID(), targetId: target.id, dialogueId: dialogue.id, node, startedAt: now, expiresAt: now + 120_000 }); return;
    }
    if (command.kind === 'drop-item') { this.drop(id, command.slot, command.itemId, command.quantity, now); return; }
    if (command.kind === 'consume-item') { this.consume(id, command.slot, command.itemId, now); return; }
    if (command.kind === 'close') { if (this.sessions.get(id)?.id === command.sessionId) this.sessions.delete(id); return; }
    const session = this.session(id, command.sessionId, now);
    if (command.kind === 'buy-item') {
      const offer = VENDOR_DEFINITIONS[session.dialogueId]?.offers.find(offer => offer.id === command.offerId);
      if (!offer) throw new Error('Offerta non disponibile.');
      const reason = this.purchaseBlocked(account, offer); if (reason) throw new Error(reason);
      const inventory = structuredClone(account.inventory!);
      if (!collectItem(inventory, offer.itemId, offer.quantity, false)) throw new Error('Zaino pieno.');
      Object.assign(account.inventory!, inventory); account.gold = (account.gold ?? 0) - offer.price;
      // Rotate the token only after success so a duplicate purchase packet cannot charge twice.
      this.advance(session, 'shop', now); this.action(id, 'purchase', offer, now); this.host.changed(id); return;
    }
    const dialogue = DIALOGUE_DEFINITIONS[session.dialogueId], node = dialogue?.nodes[session.node];
    if (!node) throw new Error('Interazione non disponibile.');
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
    const previousCompletions = questCompletions(progress);
    const rewardItems = consumed === quest.objective.quantity - delivered
      ? (quest.reward?.items ?? []).filter(item => !item.firstOnly || previousCompletions === 0) : [];
    // Reserve space for every reward before consuming a delivery or completing its mission.
    if (this.drops.size + rewardItems.length > 2048) throw new Error('Troppi oggetti a terra. Attendi qualche secondo prima di consegnare.');
    stack.quantity -= consumed; if (!stack.quantity) account.inventory!.slots[command.slot] = null;
    this.action(id, 'deliver', { itemId: command.itemId, quantity: consumed }, now, command.slot);
    advanceQuest(account.narrative!, quest, consumed, now);
    if (progress.status === 'completed') {
      const reward = questReward(quest, previousCompletions);
      account.gold = (account.gold ?? 0) + reward.gold;
      this.host.rewardXp(id, reward.xp);
      const player = this.host.players.get(id)!;
      rewardItems.forEach((item, index) => this.spawnLoot(player, item, id, now, index, 1000, 42));
    }
    this.advance(session, progress.status === 'completed' ? node.itemRequest!.completedNext : node.itemRequest!.progressNext, now); this.host.changed(id);
  }
  view(id: string, now: number): DialogueView | null {
    const session = this.sessions.get(id); if (!session) return null;
    try { this.session(id, session.id, now); } catch { this.sessions.delete(id); return null; }
    const account = this.account(id), vendor = VENDOR_DEFINITIONS[session.dialogueId];
    if (vendor) return { sessionId: session.id, targetId: session.targetId, speaker: this.host.npcs.get(session.targetId)!.name, text: vendor.greeting, choices: [],
      shop: vendor.offers.map(offer => ({ ...offer, disabledReason: this.purchaseBlocked(account, offer) })) };
    const dialogue = DIALOGUE_DEFINITIONS[session.dialogueId], node = dialogue.nodes[session.node];
    const quest = node.itemRequest ? QUEST_DEFINITIONS[node.itemRequest.questId] : undefined;
    const remaining = quest ? Math.max(0, quest.objective.quantity - (account.narrative!.quests[quest.id]?.objectives[quest.objective.id] ?? 0)) : 0;
    const rewardQuest = node.rewardQuestId ? QUEST_DEFINITIONS[node.rewardQuestId] : undefined;
    const rewardProgress = rewardQuest ? account.narrative!.quests[rewardQuest.id] : undefined;
    const rewards = rewardQuest && rewardProgress ? (rewardQuest.reward?.items ?? []).filter(item => !item.firstOnly || questCompletions(rewardProgress) === 1).map(({ itemId, quantity }) => ({ itemId, quantity })) : undefined;
    return { sessionId: session.id, targetId: session.targetId, speaker: this.host.npcs.get(session.targetId)!.name, text: node.text.replace('{remaining}', String(remaining)),
      choices: node.choices.filter(choice => !choice.condition || conditionMatches(account.narrative!, choice.condition, now)).map(({ id, label }) => ({ id, label })),
      ...(quest && remaining ? { request: { itemId: quest.objective.itemId, remaining } } : {}),
      ...(rewards ? { rewards, rewardGold: questReward(rewardQuest!, Math.max(0, questCompletions(rewardProgress!) - 1)).gold } : {}) };
  }
  private purchaseBlocked(account: Account, offer: VendorOffer): string | undefined {
    const size = ITEM_DEFINITIONS[offer.itemId]?.backpackSlots;
    if (size && size <= account.inventory!.capacity) return 'Hai già uno zaino uguale o più grande.';
    if ((account.gold ?? 0) < offer.price) return 'Gold insufficienti.';
    if (!canCollectItem(account.inventory!, offer.itemId, offer.quantity)) return 'Zaino pieno.';
    return undefined;
  }
  marker(id: string, dialogueId: string, now: number): Actor['questMarker'] {
    const dialogue = DIALOGUE_DEFINITIONS[dialogueId]; return dialogue ? questStatus(this.account(id).narrative!, dialogue.questId, now) : undefined;
  }
  killed(victim: Actor, killer: Actor | undefined, now: number): void {
    if (killer?.kind !== 'player' || !this.host.connected(killer.id)) return;
    const account = this.account(killer.id);
    let index = 0;
    for (const rule of NPC_LOOT_TABLES[victim.npcKind ?? ''] ?? []) {
      if (rule.condition && !conditionMatches(account.narrative!, rule.condition, now) || this.random() >= rule.chance) continue;
      if (this.drops.size >= 2048) return;
      this.spawnLoot(victim, rule, killer.id, now, index++, 900, 56, killer);
    }
  }
  private spawnLoot(origin: Actor, stack: ItemStack, ownerId: string, now: number, index: number, delay = 0, radius = 12, avoid?: Actor): void {
    let point = { x: origin.x, y: origin.y };
    const direction = avoid ? Math.atan2(origin.y - avoid.y, origin.x - avoid.x) : origin.aim;
    // Search reachable rings away from the killer, rather than dropping straight under a melee player.
    for (let i = 0; i < (avoid ? 72 : 12); i++) {
      const angle = direction + (index + i % 12) * Math.PI / 6;
      const reach = avoid ? [radius, 40, 72, 24, 88, 104][Math.floor(i / 12)] : radius;
      const candidate = { x: origin.x + Math.cos(angle) * reach, y: origin.y + Math.sin(angle) * reach };
      if (avoid && distance(candidate, avoid) <= avoid.radius + 26) continue;
      if (!collidesWorld(candidate.x, candidate.y, 10, this.host.world) && hasLineOfSight(origin, candidate, this.host.world)) { point = candidate; break; }
    }
    const drop: GroundItem = { id: randomUUID(), ...point, stack: { itemId: stack.itemId, quantity: stack.quantity }, ownerId, availableAt: now + delay, expiresAt: now + LOOT_ITEM_TTL,
      ...(avoid && distance(point, avoid) <= avoid.radius + 10 ? { requireOwnerExit: true } : {}) };
    this.drops.set(drop.id, drop);
  }
  private consume(id: string, slot: number, itemId: string, now: number): void {
    const player = this.host.players.get(id), account = this.account(id), stack = account.inventory!.slots[slot];
    const effect = ITEM_DEFINITIONS[itemId]?.consumable;
    if (!player || !this.host.connected(id) || player.hp <= 0 || !stack || stack.itemId !== itemId || !effect) throw new Error('Oggetto non utilizzabile.');
    if (player.hp >= player.maxHp) throw new Error('La tua vita è già al massimo.');
    if (now < (this.consumableReadyAt.get(id) ?? 0)) throw new Error('Attendi prima di usare un’altra pozione.');
    this.host.heal(player, effect.heal);
    if (--stack.quantity === 0) account.inventory!.slots[slot] = null;
    this.action(id, 'consume', { itemId, quantity: 1 }, now, slot);
    this.consumableReadyAt.set(id, now + effect.cooldownMs); this.host.changed(id);
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
    this.action(id, 'drop', { itemId, quantity }, now, slot);
    this.drops.set(drop.id, drop); this.host.changed(id);
  }
  step(now: number): void {
    for (const [id, drop] of this.drops) {
      if (now >= drop.expiresAt) { this.drops.delete(id); continue; }
      if (drop.requireOwnerExit) {
        const owner = drop.ownerId ? this.host.players.get(drop.ownerId) : undefined;
        if (!owner || distance(owner, drop) <= owner.radius + 10) continue;
        delete drop.requireOwnerExit;
      }
      for (const player of this.host.nearbyPlayers(drop, 64)) {
        if (!this.host.connected(player.id) || player.hp <= 0 || drop.ownerId && drop.ownerId !== player.id
          || now < (drop.availableAt ?? 0) || drop.droppedBy === player.id && now < (drop.ownerPickupAt ?? 0) || distance(player, drop) > player.radius + 10 || !hasLineOfSight(player, drop, this.host.world)) continue;
        const account = this.account(player.id);
        if (ITEM_DEFINITIONS[drop.stack.itemId]?.currency) account.gold = (account.gold ?? 0) + drop.stack.quantity;
        else {
          if (!collectItem(account.inventory!, drop.stack.itemId, drop.stack.quantity)) continue;
          this.action(player.id, 'collect', drop.stack, now);
        }
        this.drops.delete(id); this.host.changed(player.id); break;
      }
    }
    for (const id of this.sessions.keys()) this.view(id, now);
    for (const id of this.consumableReadyAt.keys()) if (!this.host.players.has(id)) this.consumableReadyAt.delete(id);
    for (const [id, actions] of this.inventoryActions) if (!this.host.players.has(id) || actions.every(action => now - action.at >= 2500)) this.inventoryActions.delete(id);
  }
  visibleDrops(id: string, now: number, radius: number): GroundItem[] {
    const player = this.host.players.get(id); if (!player) return [];
    return [...this.drops.values()].filter(drop => drop.expiresAt > now && (!drop.ownerId || drop.ownerId === id) && distance(player, drop) < radius).map(drop => ({ ...drop, stack: { ...drop.stack } }));
  }
  close(id: string): void { this.sessions.delete(id); }
}
