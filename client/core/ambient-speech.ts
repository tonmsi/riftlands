import { AMBIENT_SPEECH } from '../../shared/ambient-speech';
import type { Actor } from '../../shared/types';

export const SPEECH_COOLDOWN_MS = 45_000;
export const SPEECH_REPEAT_CHANCE = 0.5;
export const SPEECH_GAP_MS = 5_000;
const ENTER_RADIUS = 180, EXIT_RADIUS = 240;
interface Memory { intro: boolean; next: number; at: number; }
export interface SpeechBubble { actorId: string; text: string; startedAt: number; endsAt: number; }
export interface SpeechStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; }

/** Each viewer owns their triggers; other players cannot consume or restart a line. */
export class AmbientSpeech {
  private owner = '';
  private memory: Record<string, Memory> = {};
  private inside = new Set<string>();
  private active: SpeechBubble | null = null;
  private nextAt = 0;
  constructor(private readonly storage?: SpeechStorage, private readonly random: () => number = Math.random) {}

  reset(): void { this.inside.clear(); this.active = null; }

  update(self: Actor | null, actors: readonly Actor[], now: number, enabled: boolean,
    visible: (actor: Actor) => boolean = () => true): SpeechBubble | null {
    if (!self) { this.reset(); return null; }
    const owner = `riftlands:ambient:v1:${self.id}:${self.classId}`;
    if (this.owner !== owner) {
      this.owner = owner; this.memory = {}; this.reset(); this.nextAt = 0;
      try {
        const parsed: unknown = JSON.parse(this.storage?.getItem(owner) ?? '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed).slice(-64)) {
            const m = value as Memory;
            if (m && typeof m.intro === 'boolean' && Number.isSafeInteger(m.next) && m.next >= 0
              && Number.isFinite(m.at) && m.at >= 0 && m.at <= now) this.memory[key] = m;
          }
        }
      } catch { /* Unavailable storage must not interrupt the game. */ }
    }
    if (!enabled || self.hp <= 0) { this.active = null; return null; }
    const nearby = actors.filter(a => a.kind === 'npc' && a.disposition === 'neutral' && a.hp > 0
      && a.npcKind && a.npcKind !== 'boss' && AMBIENT_SPEECH[a.npcKind]);
    for (const id of this.inside) {
      const actor = nearby.find(a => a.id === id);
      if (!actor || Math.hypot(actor.x - self.x, actor.y - self.y) > EXIT_RADIUS) this.inside.delete(id);
    }
    // Consume every entry immediately, including losers and entries during the lock.
    // Nothing is queued: a neighbour must leave and enter again to get another chance.
    const entrants = nearby.filter(actor => {
      if (this.inside.has(actor.id) || Math.hypot(actor.x - self.x, actor.y - self.y) > ENTER_RADIUS || !visible(actor)) return false;
      this.inside.add(actor.id);
      return true;
    });
    if (this.active) {
      const actor = nearby.find(a => a.id === this.active!.actorId);
      if (now >= this.active.endsAt || !actor || !visible(actor)
        || Math.hypot(actor.x - self.x, actor.y - self.y) > EXIT_RADIUS) this.active = null;
      else return this.active;
    }
    if (now < this.nextAt) return null;
    const keyFor = (actor: Actor) => `${actor.npcKind}:${actor.id}`;
    const priority = (actor: Actor) => actor.questMarker === 'active' ? 0 : !this.memory[keyFor(actor)]?.intro ? 1 : 2;
    const eligible = entrants.filter(actor => {
      const memory = this.memory[keyFor(actor)];
      return !memory || now - memory.at >= SPEECH_COOLDOWN_MS;
    });
    eligible.sort((a, b) => priority(a) - priority(b)
      || Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y) || a.id.localeCompare(b.id));
    for (const actor of eligible) {
      const key = keyFor(actor), memory = this.memory[key];
      // Roll once for the selected NPC, never each frame or for a fallback neighbour.
      // A silent entry consumes neither the cooldown nor the next variant.
      if (memory?.intro && this.random() >= SPEECH_REPEAT_CHANCE) return null;
      const definition = AMBIENT_SPEECH[actor.npcKind as keyof typeof AMBIENT_SPEECH]!;
      const text = memory?.intro ? definition.lines[memory.next % definition.lines.length] : definition.intro;
      this.memory[key] = { intro: true, next: memory?.intro ? (memory.next + 1) % definition.lines.length : 0, at: now };
      const entries = Object.entries(this.memory).sort((a, b) => a[1].at - b[1].at).slice(-64);
      this.memory = Object.fromEntries(entries);
      try { this.storage?.setItem(this.owner, JSON.stringify(this.memory)); } catch { /* Session memory remains available. */ }
      const duration = Math.max(4500, Math.min(7500, text.length * 65));
      this.active = { actorId: actor.id, text, startedAt: now, endsAt: now + duration };
      this.nextAt = now + duration + SPEECH_GAP_MS;
      return this.active;
    }
    return null;
  }
}
