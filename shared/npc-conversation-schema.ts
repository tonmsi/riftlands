import type { AmbientSpeechDefinition } from './ambient-speech';
import { DIALOGUE_DEFINITIONS } from './narrative';
import { VENDOR_DEFINITIONS } from './vendors';

export interface NpcDialogueChoice { id: string; label: string; next?: string; }
export interface NpcDialogueNode { text: string; choices: NpcDialogueChoice[]; }
export type NpcDialogue = { kind: 'none' } | { kind: 'existing'; id: string }
  | { kind: 'custom'; start: string; nodes: Record<string, NpcDialogueNode> };
/** Missing inherits; null explicitly silences the automatic bubbles. */
export interface NpcConversation { speech?: AmbientSpeechDefinition | null; dialogue?: NpcDialogue; }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && !!v.trim() && v.length <= max;
const id = (v: unknown) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v);
export function validNpcConversation(v: unknown): v is NpcConversation {
  if (!object(v) || Object.keys(v).some(k => !['speech', 'dialogue'].includes(k))) return false;
  if (v.speech !== undefined && v.speech !== null && (!object(v.speech) || !text(v.speech.intro, 400)
    || !Array.isArray(v.speech.lines) || v.speech.lines.length > 32 || !v.speech.lines.every((line: unknown) => text(line, 400)))) return false;
  const d = v.dialogue;
  if (d === undefined) return true;
  if (!object(d)) return false;
  if (d.kind === 'none') return Object.keys(d).length === 1;
  if (d.kind === 'existing') return Object.keys(d).every(k => ['kind', 'id'].includes(k)) && typeof d.id === 'string'
    && (Object.hasOwn(DIALOGUE_DEFINITIONS, d.id) || Object.hasOwn(VENDOR_DEFINITIONS, d.id));
  if (d.kind !== 'custom' || Object.keys(d).some(k => !['kind', 'start', 'nodes'].includes(k)) || !object(d.nodes)
    || !id(d.start) || !Object.hasOwn(d.nodes, d.start) || Object.keys(d.nodes).length > 64) return false;
  for (const [key, node] of Object.entries(d.nodes)) {
    if (!id(key) || !object(node) || Object.keys(node).some(k => !['text', 'choices'].includes(k)) || !text(node.text, 2000)
      || !Array.isArray(node.choices) || !node.choices.length || node.choices.length > 8) return false;
    const ids = new Set<string>();
    for (const choice of node.choices) {
      if (!object(choice) || Object.keys(choice).some(k => !['id', 'label', 'next'].includes(k)) || !id(choice.id)
        || ids.has(choice.id) || !text(choice.label, 160) || (choice.next !== undefined && (!id(choice.next) || !Object.hasOwn(d.nodes, choice.next)))) return false;
      ids.add(choice.id);
    }
  }
  return true;
}
