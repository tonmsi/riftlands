import type { Vec2 } from './types';
export const WARP_KEY_OPEN_MS = 5 * 60_000;
export interface WarpKeyItem { id: string; name: string; }
export interface WarpKeyPickup extends Vec2 { id: string; name: string; }
export interface WarpGateView { id: string; openedUntil: number; }
