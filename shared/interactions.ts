import type { ItemStack } from './items';
export const INTERACTION_RANGE = 144;
export const GROUND_ITEM_TTL = 10_000;
export const LOOT_ITEM_TTL = 120_000;
export interface GroundItem { id: string; x: number; y: number; stack: ItemStack; expiresAt: number; ownerId?: string; availableAt?: number; droppedBy?: string; ownerPickupAt?: number; }
export interface DialogueView { sessionId: string; targetId: string; speaker: string; text: string; choices: { id: string; label: string }[]; request?: { itemId: string; remaining: number }; }
export type InteractionCommand =
  | { kind: 'talk'; targetId: string }
  | { kind: 'choose'; sessionId: string; choiceId: string }
  | { kind: 'close'; sessionId: string }
  | { kind: 'use-item'; sessionId: string; slot: number; itemId: string }
  | { kind: 'consume-item'; slot: number; itemId: string }
  | { kind: 'drop-item'; slot: number; itemId: string; quantity: number };
export function validInteractionCommand(value: unknown): value is InteractionCommand {
  const command = value as InteractionCommand;
  if (!command || typeof command !== 'object') return false;
  const text = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 160;
  const slot = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < 64;
  switch (command.kind) {
    case 'talk': return text(command.targetId);
    case 'choose': return text(command.sessionId) && text(command.choiceId);
    case 'close': return text(command.sessionId);
    case 'use-item': return text(command.sessionId) && slot(command.slot) && text(command.itemId);
    case 'consume-item': return slot(command.slot) && text(command.itemId);
    case 'drop-item': return slot(command.slot) && text(command.itemId) && Number.isSafeInteger(command.quantity) && command.quantity > 0 && command.quantity <= 9999;
    default: return false;
  }
}
