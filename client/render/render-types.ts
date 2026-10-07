import type { AbilitySlot, Actor, ArenaGateState, ClassId, GameEvent, Pickup, Projectile, Trap, Vec2 } from '../../shared/types';
import type { GroundItem } from '../../shared/interactions';
import type { Inventory } from '../../shared/items';
import type { BossDrop, BossLockState, BossPreparationState, BossWindup } from '../../shared/bosses';
export interface RenderFrame {
  ambientSpeechBlocked?: boolean;
  spectating?: boolean;
  fishing?: import('../../shared/fishing/model').FishingView | null;
  fishingTarget?: Vec2;
  goldDrops?: BossDrop[];
  groundItems?: GroundItem[];
  inventory?: Inventory;
  bossWindups?: BossWindup[];
  bossLocks?: BossLockState[];
  bossPreparations?: BossPreparationState[];
  arenaGate?: ArenaGateState;
  time: number;
  self: Actor | null;
  actors: Actor[];
  projectiles: Projectile[];
  pickups: Pickup[];
  traps: Trap[];
  events: GameEvent[];
  selectedId: string | null;
  previewClass: ClassId;
  playing: boolean;
  moveDirection?: Vec2 | null;
  aimPreview?: { slot: AbilitySlot; angle: number } | null;
}
export interface RenderBounds { left: number; top: number; right: number; bottom: number; }
/** Camera and pixel geometry for one drawing pass. Owned by Renderer. */
export interface TerrainViewport {
  camera: Readonly<Vec2>;
  width: number;
  height: number;
  dpr: number;
  zoom: number;
}
