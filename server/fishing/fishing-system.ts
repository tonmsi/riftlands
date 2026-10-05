import type { Actor, Vec2 } from '../../shared/types';
import type { World } from '../../shared/world';
import type { Account } from '../store';
import { insertItem, inventoryCount, ITEM_DEFINITIONS, type ItemStack } from '../../shared/items';
import { randomUUID } from '../../shared/id';
import { FISH, FISHING, type FishingCommand, type FishingView } from '../../shared/fishing/model';
import { nearbyFishingWater, validFishingCast } from '../../shared/fishing/water';
import { fishingRecoverySpeed } from '../../shared/fishing/fight';
interface Host {
  players: ReadonlyMap<string, Actor>; accounts: ReadonlyMap<string, Account>; world: World;
  connected(id: string): boolean; combatAt(id: string): number; changed(id: string): void;
  rewardDrop(id: string, item: ItemStack, now: number, ttl?: number): void;
  feedback(id: string, kind: 'consume' | 'collect', item: ItemStack, now: number, slot?: number): void;
}
interface Session { view: FishingView; origin: Vec2; startedAt: number; biteAt: number; reelUntil: number; dangerMs: number; slackMs: number; lastAt: number; fishIndex: number; hasBite: boolean; castPoint?: Vec2; }
/** Fishing authority owns timing, RNG, catches and bait consumption. No client success claims. */
export class FishingSystem {
  private sessions = new Map<string, Session>();
  private shoreCache = new Map<string, { key: string; available: boolean }>();
  constructor(private host: Host, private random = Math.random) {}
  active(id: string): boolean { return this.sessions.has(id); }
  busy(id: string): boolean { const phase = this.sessions.get(id)?.view.phase; return phase === 'waiting' || phase === 'bite' || phase === 'fight'; }
  close(id: string): void { const s = this.sessions.get(id); if (s && ['ready', 'result'].includes(s.view.phase)) this.returnBait(id, s.view, s.lastAt); this.sessions.delete(id); }
  available(id: string): boolean {
    const player = this.host.players.get(id), inventory = this.host.accounts.get(id)?.inventory;
    if (!player || player.hp <= 0 || !inventory || !inventoryCount(inventory, 'fishing-rod')) return false;
    const key = `${Math.round(player.x / 8)}:${Math.round(player.y / 8)}:${this.host.world.authoringRevision}`;
    const cached = this.shoreCache.get(id); if (cached?.key === key) return cached.available;
    const available = !!nearbyFishingWater(this.host.world, player); this.shoreCache.set(id, { key, available }); return available;
  }
  view(id: string): FishingView | null { const view = this.sessions.get(id)?.view; return view ? structuredClone(view) : null; }
  private validPlayer(id: string): Actor {
    const player = this.host.players.get(id);
    if (!player || player.hp <= 0 || !this.host.connected(id) || !this.host.accounts.get(id)?.inventory || !inventoryCount(this.host.accounts.get(id)!.inventory!, 'fishing-rod')) throw new Error('Serve una canna da pesca nella sacca.');
    return player;
  }
  private hasBait(id: string, view: FishingView): boolean {
    const account = this.host.accounts.get(id)!;
    if (view.baitId === 'gold') return (account.gold ?? 0) >= 1;
    const stack = view.baitSlot === undefined ? null : account.inventory!.slots[view.baitSlot];
    return !!stack && stack.itemId === view.baitId && stack.quantity >= 1;
  }
  private returnBait(id: string, view: FishingView, now: number): void {
    if (!view.baitId) return;
    const account = this.host.accounts.get(id)!;
    const used = view.baitUsesRemaining !== undefined && view.baitUsesRemaining < 3;
    const bait = { itemId: view.baitId, quantity: 1 };
    if (!used) {
      if (view.baitId === 'gold') account.gold = (account.gold ?? 0) + 1;
      else if (insertItem(account.inventory!, view.baitId, 1)) this.host.feedback(id, 'collect', bait, now);
      else this.host.rewardDrop(id, bait, now, FISHING.catchDropTtlMs);
    }
    view.baitId = undefined; view.baitSlot = undefined; view.baitUsesRemaining = undefined; this.host.changed(id);
  }
  command(id: string, command: FishingCommand, now: number): void {
    const player = this.validPlayer(id);
    if (command.kind === 'open') {
      if (this.active(id)) return;
      if (!this.available(id)) throw new Error('Avvicinati a una riva per pescare.');
      if (now - this.host.combatAt(id) < 5000) throw new Error('Aspetta di uscire dal combattimento.');
      this.sessions.set(id, { origin: { x: player.x, y: player.y }, startedAt: now, lastAt: now, biteAt: 0, reelUntil: 0, dangerMs: 0, slackMs: 0, fishIndex: 0, hasBite: false,
        view: { id: randomUUID(), phase: 'ready', tension: 0, progress: 0, danger: 0, reeling: false, message: 'Scegli un’esca e il punto in acqua.' } }); return;
    }
    const session = this.sessions.get(id);
    if (!session || session.view.id !== command.sessionId) throw new Error('Sessione di pesca terminata.');
    const view = session.view;
    if (command.kind === 'close') { this.close(id); return; }
    if (command.kind === 'bait') {
      if (this.busy(id)) throw new Error('Ritira prima la lenza.');
      if (!Object.hasOwn(ITEM_DEFINITIONS, command.itemId) || ITEM_DEFINITIONS[command.itemId].fishingBait === false) throw new Error('Questo oggetto non può fungere da esca.');
      if (view.baitId === command.itemId && view.baitSlot === command.slot) return;
      const candidate = { ...view, baitId: command.itemId, baitSlot: command.slot };
      if (!this.hasBait(id, candidate)) throw new Error('Non hai questa esca.');
      const uses = ITEM_DEFINITIONS[command.itemId].fishingBaitConsumable ? 3 : undefined;
      this.returnBait(id, view, now);
      const account = this.host.accounts.get(id)!;
      if (command.itemId === 'gold') account.gold = (account.gold ?? 0) - 1;
      else { const stack = account.inventory!.slots[command.slot!]!; if (--stack.quantity === 0) account.inventory!.slots[command.slot!] = null; }
      this.host.feedback(id, 'consume', { itemId: command.itemId, quantity: 1 }, now, command.slot); this.host.changed(id);
      view.baitId = command.itemId; view.baitSlot = command.itemId === 'gold' ? undefined : command.slot;
      view.baitUsesRemaining = uses;
      view.phase = 'ready'; view.outcome = undefined; view.catchId = undefined; view.message = 'Esca montata. Scegli il punto in acqua, poi lancia.'; return;
    }
    if (command.kind === 'cast') {
      if (this.busy(id)) return;
      if (!view.baitId) throw new Error('Seleziona un’esca disponibile.');
      const point = { x: command.x, y: command.y };
      if (!validFishingCast(this.host.world, player, point)) throw new Error('Lancia nell’acqua vicina, senza ostacoli.');
      session.hasBite = this.random() < FISHING.biteChance;
      const bait = ITEM_DEFINITIONS[view.baitId!].fishingBait || 'odd', weights = FISH.map(f => f.attraction[bait] * f.spawnWeight);
      let roll = this.random() * weights.reduce((a, b) => a + b, 0), index = 0;
      for (; index < weights.length - 1; index++) { if (roll < weights[index]) break; roll -= weights[index]; }
      session.fishIndex = index; const fish = FISH[index];
      view.weightKg = Math.round((fish.minKg + this.random() * (fish.maxKg - fish.minKg)) * 100) / 100;
      view.fishId = undefined; view.bobber = point; view.castAt = now; view.phase = 'waiting'; view.tension = .1; view.progress = 0; view.danger = 0; view.outcome = undefined; view.reeling = false;
      session.castPoint = point; view.distanceM = view.initialDistanceM = Math.hypot(point.x - player.x, point.y - player.y) / FISHING.unitsPerMeter;
      view.catchId = undefined; view.resultId = undefined; view.rarity = undefined; view.slackDanger = 0; view.noBite = false;
      view.message = 'Aspetta l’abboccata…'; session.biteAt = now + (session.hasBite ? FISHING.waitMinMs + this.random() * (FISHING.waitMaxMs - FISHING.waitMinMs) : FISHING.emptyWaitMs); session.lastAt = now; session.dangerMs = session.slackMs = session.reelUntil = 0; return;
    }
    if (command.kind === 'reel') {
      if (!command.held) { session.reelUntil = 0; view.reeling = false; return; }
      if (view.phase === 'waiting') { this.finish(id, session, 'withdrawn', now); return; }
      if (view.phase === 'bite') {
        if (now >= view.biteUntil!) { this.finish(id, session, 'missed', now); return; }
        view.phase = 'fight'; view.fishId = FISH[session.fishIndex].id; view.rarity = FISH[session.fishIndex].rarity; view.tension = .65; view.message = 'Tieni per recuperare · Rilascia per allentare'; session.lastAt = now;
      }
      if (view.phase === 'fight') { session.reelUntil = now + FISHING.reelLeaseMs; view.reeling = true; }
    }
  }
  private finish(id: string, session: Session, outcome: NonNullable<FishingView['outcome']>, now: number): void {
    const account = this.host.accounts.get(id)!, view = session.view;
    if (outcome === 'caught') {
      const fish = { itemId: FISH[session.fishIndex].id, quantity: 1 };
      view.catchOnGround = !insertItem(account.inventory!, fish.itemId, 1);
      if (!view.catchOnGround) this.host.feedback(id, 'collect', fish, now);
      else this.host.rewardDrop(id, fish, now, FISHING.catchDropTtlMs);
      view.catchId = randomUUID(); view.catchAt = now; view.fishId = fish.itemId; view.rarity = FISH[session.fishIndex].rarity;
      this.host.changed(id);
    }
    const lost = outcome === 'broken' || outcome === 'escaped' || outcome === 'missed';
    if (!lost && view.baitUsesRemaining !== undefined) view.baitUsesRemaining--;
    if (lost || view.baitUsesRemaining === 0) { view.baitId = undefined; view.baitSlot = undefined; view.baitUsesRemaining = undefined; }
    view.resultId = randomUUID();
    view.phase = 'result'; view.outcome = outcome; view.reeling = false; view.bobber = undefined; view.danger = 0;
    view.message = outcome === 'caught' ? `${FISH[session.fishIndex].name} · ${view.weightKg} kg!` : outcome === 'broken' ? 'Filo spezzato! Esca persa.' : outcome === 'missed' ? 'Ferrata mancata! Esca persa.' : outcome === 'withdrawn' ? 'Lenza ritirata.' : 'Pesce slamato! Esca persa.';
    if (view.noBite) view.message = 'Nessuna abboccata.';
    if (!lost) view.message += view.baitId ? view.baitUsesRemaining === undefined ? ' Esca pronta: puoi rilanciare.' : ` Esca pronta · ${view.baitUsesRemaining}/3 lanci.` : ' Esca deteriorata: montane un’altra.';
  }
  step(now: number): void {
    for (const id of this.shoreCache.keys()) if (!this.host.players.has(id)) this.shoreCache.delete(id);
    for (const [id, session] of this.sessions) {
      const player = this.host.players.get(id);
      if (!player || !this.host.connected(id) || player.hp <= 0 || this.host.combatAt(id) > session.startedAt || Math.hypot(player.x - session.origin.x, player.y - session.origin.y) > 32 || !inventoryCount(this.host.accounts.get(id)?.inventory ?? { version: 1, capacity: 1, slots: [null] }, 'fishing-rod')) { this.close(id); continue; }
      const view = session.view, dt = Math.min(.1, Math.max(0, (now - session.lastAt) / 1000)); session.lastAt = now;
      if (view.phase === 'waiting' && now >= session.biteAt) {
        if (!session.hasBite) { view.noBite = true; this.finish(id, session, 'withdrawn', now); }
        else { view.phase = 'bite'; view.biteUntil = now + FISHING.biteWindowMs; view.message = 'ABBOCCATA! Premi il mulinello per ferrare!'; }
      }
      else if (view.phase === 'bite' && now >= view.biteUntil!) this.finish(id, session, 'missed', now);
      else if (view.phase === 'fight') {
        const fish = FISH[session.fishIndex], size = view.weightKg! / fish.maxKg;
        view.reeling = now < session.reelUntil;
        const surge = .5 + .5 * Math.sin((now - view.castAt!) / 650 * fish.speed);
        view.tension = Math.max(0, Math.min(1, view.tension + dt * (view.reeling ? .28 + .1 * fish.power + .12 * size + .12 * surge : -.55 + fish.power * .15 + size * .15)));
        session.dangerMs = view.tension > FISHING.breakThreshold ? session.dangerMs + dt * 1000 : 0;
        session.slackMs = view.tension < FISHING.slackThreshold ? session.slackMs + dt * 1000 : Math.max(0, session.slackMs - dt * 500);
        view.danger = Math.min(1, session.dangerMs / FISHING.breakMs);
        view.slackDanger = Math.min(1, session.slackMs / FISHING.slackMs);
        if (session.dangerMs >= FISHING.breakMs) { this.finish(id, session, 'broken', now); continue; }
        if (session.slackMs >= FISHING.slackMs || now - view.castAt! > 120000) { this.finish(id, session, 'escaped', now); continue; }
        const recovery = view.reeling ? fishingRecoverySpeed(view.tension, fish, view.weightKg!) : 0;
        const escape = view.tension < .6 ? (.6 - view.tension) * (1 + fish.power + size) : !view.reeling ? .15 * fish.speed : 0;
        view.distanceM = Math.max(FISHING.catchDistanceM, Math.min(view.initialDistanceM! * 1.6, view.distanceM! + dt * (escape - recovery)));
        view.progress = Math.max(0, Math.min(1, (view.initialDistanceM! - view.distanceM) / (view.initialDistanceM! - FISHING.catchDistanceM)));
        const ratio = view.distanceM / view.initialDistanceM!;
        view.bobber = { x: session.origin.x + (session.castPoint!.x - session.origin.x) * ratio, y: session.origin.y + (session.castPoint!.y - session.origin.y) * ratio };
        if (view.distanceM <= FISHING.catchDistanceM) this.finish(id, session, 'caught', now);
      }
    }
  }
}
