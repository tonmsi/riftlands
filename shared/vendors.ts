export interface VendorOffer { id: string; itemId: string; quantity: number; price: number; }
export interface VendorDefinition { id: string; greeting: string; offers: readonly VendorOffer[]; }
/** Prices and stock are server-owned; buying one offer is one atomic transaction. */
export const VENDOR_DEFINITIONS: Readonly<Record<string, VendorDefinition>> = {
  'outpost-shop': {
    id: 'outpost-shop', greeting: 'Ti serve più spazio per il viaggio? Ho zaini e pozioni. Gli zaini più grandi sostituiscono quello che indossi.',
    offers: [
      { id: 'bag-2', itemId: 'backpack-2', quantity: 1, price: 10 },
      { id: 'bag-3', itemId: 'backpack-3', quantity: 1, price: 25 },
      { id: 'bag-4', itemId: 'backpack-4', quantity: 1, price: 50 },
      { id: 'bag-5', itemId: 'backpack-5', quantity: 1, price: 100 },
      { id: 'potion', itemId: 'healing-potion', quantity: 1, price: 3 },
    ],
  },
};
