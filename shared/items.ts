export interface ItemDefinition {
  id: string; name: string; description: string; maxStack: number;
  appearance: 'slime-innards' | 'backpack' | 'potion' | 'gold' | 'rod' | 'fish';
  fishingBait?: import('./fishing/model').BaitKind | false;
  fishingBaitConsumable?: boolean;
  backpackSlots?: number;
  consumable?: { heal: number; cooldownMs: number };
  currency?: true;
}
export const MAX_BACKPACK_SLOTS = 5;
export const ITEM_DEFINITIONS: Readonly<Record<string, ItemDefinition>> = {
  'slime-innards': { id: 'slime-innards', name: 'Interiora di gelatina', description: 'Viscide, maleodoranti. Perfette per preparare esche puzzolenti.', maxStack: 9999, appearance: 'slime-innards', fishingBait: 'organic', fishingBaitConsumable: true },
  gold: { id: 'gold', name: 'Monete d’oro', description: 'Vanno direttamente nel saldo quando le raccogli.', maxStack: 9999, appearance: 'gold', currency: true, fishingBait: 'shiny' },
  'fishing-rod': { id: 'fishing-rod', name: 'Canna da pesca', description: 'Premi vicino a una riva per pescare. Seleziona un’esca dalla sacca.', maxStack: 1, appearance: 'rod', fishingBait: false },
  'fish-pike': { id: 'fish-pike', name: 'Luccio argentato', description: 'Predatore veloce, attratto dai riflessi dei metalli.', maxStack: 20, appearance: 'fish', fishingBait: 'organic', fishingBaitConsumable: true },
  'fish-catfish': { id: 'fish-catfish', name: 'Siluro di fondale', description: 'Un pesce pesante che cerca esche dall’odore intenso.', maxStack: 20, appearance: 'fish', fishingBait: 'organic', fishingBaitConsumable: true },
  'fish-perch': { id: 'fish-perch', name: 'Persico di riva', description: 'Piccolo e curioso: assaggia anche le esche insolite.', maxStack: 20, appearance: 'fish', fishingBait: 'organic', fishingBaitConsumable: true },
  'healing-potion': { id: 'healing-potion', name: 'Pozione curativa', description: 'Recupera 40 punti vita. Puoi usarne una ogni 4 secondi.', maxStack: 20, appearance: 'potion', fishingBaitConsumable: true, consumable: { heal: 40, cooldownMs: 4000 } },
  ...Object.fromEntries([2, 3, 4, 5].map(slots => [`backpack-${slots}`, {
    id: `backpack-${slots}`, name: `Zaino da ${slots} slot`, description: `Porta la capienza a ${slots} slot. Gli zaini contenuti non aggiungono spazio.`,
    maxStack: 1, appearance: 'backpack' as const, backpackSlots: slots, fishingBait: false as const,
  }])),
};
export interface ItemStack { itemId: string; quantity: number; }
export interface Inventory { version: 1; capacity: number; slots: (ItemStack | null)[]; backpackId?: string; }
export const newInventory = (): Inventory => ({ version: 1, capacity: 1, slots: [null] });
export function validInventory(value: unknown): value is Inventory {
  const inventory = value as Inventory;
  return !!inventory && inventory.version === 1 && Number.isSafeInteger(inventory.capacity) && inventory.capacity >= 1 && inventory.capacity <= MAX_BACKPACK_SLOTS
    && (inventory.backpackId === undefined || typeof inventory.backpackId === 'string' && ITEM_DEFINITIONS[inventory.backpackId]?.backpackSlots === inventory.capacity)
    && Array.isArray(inventory.slots) && inventory.slots.length === inventory.capacity && inventory.slots.every(stack => stack === null || !!stack
      && typeof stack.itemId === 'string' && Object.hasOwn(ITEM_DEFINITIONS, stack.itemId) && !ITEM_DEFINITIONS[stack.itemId].currency && Number.isSafeInteger(stack.quantity)
      && stack.quantity > 0 && stack.quantity <= ITEM_DEFINITIONS[stack.itemId].maxStack);
}
/** One-time cleanup of worn bait saved by the previous fishing implementation. */
export function discardLegacyUsedBaits(inventory: Inventory): boolean {
  let changed = false;
  inventory.slots.forEach((stack, slot) => {
    if (stack && 'baitUsesRemaining' in stack) { inventory.slots[slot] = null; changed = true; }
  });
  return changed;
}
export function inventoryCount(inventory: Inventory, itemId: string): number { return inventory.slots.reduce((count, stack) => count + (stack?.itemId === itemId ? stack.quantity : 0), 0); }
export function canInsertItem(inventory: Inventory, itemId: string, quantity: number): boolean {
  const item = ITEM_DEFINITIONS[itemId]; if (!item || item.currency || !Number.isSafeInteger(quantity) || quantity < 1) return false;
  return inventory.slots.reduce((room, stack) => room + (stack === null ? item.maxStack : stack.itemId === itemId ? item.maxStack - stack.quantity : 0), 0) >= quantity;
}
/** Shared by ground rendering and server collection; currency and upgrades do not need an empty slot. */
export function canCollectItem(inventory: Inventory, itemId: string, quantity: number): boolean {
  const item = ITEM_DEFINITIONS[itemId]; if (!item || !Number.isSafeInteger(quantity) || quantity < 1) return false;
  if (item.currency) return true;
  if (item.backpackSlots && item.backpackSlots > inventory.capacity) return quantity === 1 && item.backpackSlots <= MAX_BACKPACK_SLOTS;
  return canInsertItem(inventory, itemId, quantity);
}
/** All-or-nothing insertion: a full slot never destroys a ground drop. */
export function insertItem(inventory: Inventory, itemId: string, quantity: number): boolean {
  const item = ITEM_DEFINITIONS[itemId]; if (!canInsertItem(inventory, itemId, quantity)) return false;
  let remaining = quantity;
  const order = inventory.slots.flatMap((stack, index) => stack?.itemId === itemId ? [index] : [])
    .concat(inventory.slots.flatMap((stack, index) => stack === null ? [index] : []));
  for (const i of order) {
    if (!remaining) break;
    const stack = inventory.slots[i]; if (stack && stack.itemId !== itemId) continue;
    const add = Math.min(remaining, item.maxStack - (stack?.quantity ?? 0));
    inventory.slots[i] = { itemId, quantity: (stack?.quantity ?? 0) + add }; remaining -= add;
  }
  return true;
}

/** Upgrade is atomic: existing contents and the previously equipped backpack are preserved. */
export function collectItem(inventory: Inventory, itemId: string, quantity: number, keepPreviousBackpack = true): boolean {
  const capacity = ITEM_DEFINITIONS[itemId]?.backpackSlots;
  if (!capacity || capacity <= inventory.capacity) return insertItem(inventory, itemId, quantity);
  if (quantity !== 1 || capacity > MAX_BACKPACK_SLOTS) return false;
  const upgraded: Inventory = { ...inventory, backpackId: itemId, capacity, slots: [...inventory.slots, ...Array<ItemStack | null>(capacity - inventory.capacity).fill(null)] };
  if (keepPreviousBackpack && inventory.backpackId && !insertItem(upgraded, inventory.backpackId, 1)) return false;
  Object.assign(inventory, upgraded); return true;
}
