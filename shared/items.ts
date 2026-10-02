export interface ItemDefinition { id: string; name: string; description: string; maxStack: number; appearance: 'slime-innards'; }
export const ITEM_DEFINITIONS: Readonly<Record<string, ItemDefinition>> = {
  'slime-innards': { id: 'slime-innards', name: 'Interiora di gelatina', description: 'Viscide, maleodoranti. Perfette per preparare esche puzzolenti.', maxStack: 9999, appearance: 'slime-innards' },
};
export interface ItemStack { itemId: string; quantity: number; }
export interface Inventory { version: 1; capacity: number; slots: (ItemStack | null)[]; }
export const newInventory = (): Inventory => ({ version: 1, capacity: 1, slots: [null] });
export function validInventory(value: unknown): value is Inventory {
  const inventory = value as Inventory;
  return !!inventory && inventory.version === 1 && Number.isSafeInteger(inventory.capacity) && inventory.capacity >= 1 && inventory.capacity <= 64
    && Array.isArray(inventory.slots) && inventory.slots.length === inventory.capacity && inventory.slots.every(stack => stack === null || !!stack
      && typeof stack.itemId === 'string' && Object.hasOwn(ITEM_DEFINITIONS, stack.itemId) && Number.isSafeInteger(stack.quantity)
      && stack.quantity > 0 && stack.quantity <= ITEM_DEFINITIONS[stack.itemId].maxStack);
}
export function inventoryCount(inventory: Inventory, itemId: string): number { return inventory.slots.reduce((count, stack) => count + (stack?.itemId === itemId ? stack.quantity : 0), 0); }
/** All-or-nothing insertion: a full slot never destroys a ground drop. */
export function insertItem(inventory: Inventory, itemId: string, quantity: number): boolean {
  const item = ITEM_DEFINITIONS[itemId]; if (!item || !Number.isSafeInteger(quantity) || quantity < 1) return false;
  const room = inventory.slots.reduce((n, stack) => n + (stack === null ? item.maxStack : stack.itemId === itemId ? item.maxStack - stack.quantity : 0), 0);
  if (room < quantity) return false;
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
