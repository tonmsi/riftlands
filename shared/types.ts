import type { BossDrop, BossLockState, BossPreparationState, BossWindup } from './bosses';
export type ClassId = 'mage' | 'warrior' | 'paladin' | 'hunter';
export type AbilitySlot = 'basic' | 'q' | 'e' | 'r';
export type Vec2 = { x: number; y: number };
export type RoomMode = 'world' | 'arena' | 'battleground';
export interface Actor { pvpUntil?: number; }
export interface RoomState { id: string; epoch: number; mode: RoomMode; seed: number; }
export interface ArenaGateState { phase: 'waiting' | 'countdown' | 'combat' | 'reenter' | 'full'; players: number; startsAt?: number; }
export type TileKind = 'grass' | 'path' | 'water' | 'rock' | 'bush' | 'mud';
export type Biome = 'meadow' | 'forest' | 'marsh';
export type PickupKind = 'heal' | 'haste' | 'power' | 'weakness';
export interface AbilityDef { targeting: 'directional' | 'self'; name: string; description: string; cost: number; cooldown: number; range: number; damage: number; kind: 'projectile' | 'melee' | 'area' | 'heal' | 'shield' | 'dash' | 'trap'; radius: number; color: string; duration?: number; speed?: number; slow?: number; }
export interface ClassDef { id: ClassId; name: string; subtitle: string; description: string; color: string; resource: 'mana' | 'rage'; maxHp: number; maxResource: number; speed: number; armor: number; abilities: Record<AbilitySlot, AbilityDef>; }
export interface InputCommand { seq: number; dx: number; dy: number; aim: number; cast?: AbilitySlot; autoAim?: boolean; }
export interface StatusEffect { kind: 'haste' | 'power' | 'weakness' | 'slow' | 'shield' | 'root'; until: number; }
export interface Actor extends Vec2 { id: string; kind: 'player' | 'npc'; name: string; classId: ClassId; radius: number; hp: number; maxHp: number; resource: number; maxResource: number; aim: number; speed: number; level: number; xp: number; kills: number; deaths: number; teamId: string | null; hidden: boolean; revealedUntil: number; deadUntil: number; spawnProtectedUntil: number; effects: StatusEffect[]; cooldowns: Record<AbilitySlot, number>; npcKind?: 'slime' | 'sentinel' | 'wisp' | 'boss'; bossKey?: string; bossSkin?: string; }
export interface Projectile extends Vec2 { id: string; ownerId: string; vx: number; vy: number; radius: number; damage: number; expiresAt: number; color: string; slow?: number; }
export interface Pickup extends Vec2 { id: string; kind: PickupKind; radius: number; }
export interface Trap extends Vec2 { id: string; ownerId: string; teamId: string | null; radius: number; damage: number; duration: number; expiresAt: number; color: string; }
export interface GameEvent extends Vec2 { id: string; kind: 'cast' | 'hit' | 'heal' | 'death' | 'pickup' | 'respawn'; at: number; duration: number; radius: number; color: string; actorId?: string; targetId?: string; aim?: number; abilityKind?: AbilityDef['kind']; amount?: number; text?: string; }
export interface SocialPlayer { id: string; name: string; classId: ClassId; level: number; teamId: string | null; friend: boolean; }
export interface SocialState { friends: { id: string; name: string; online: boolean }[]; requests: { id: string; name: string }[]; teamInvites: { id: string; name: string; teamId: string }[]; team: { id: string; leaderId: string; members: { id: string; name: string; online: boolean; hp?: number; maxHp?: number }[] } | null; nearby: SocialPlayer[]; }
export interface PublicAccount { id: string; name: string; kills: number; deaths: number; xp: number; }
export interface PublicAccount { gold?: number; }
export interface Snapshot { gold?: number; goldDrops?: BossDrop[]; bossWindups?: BossWindup[]; bossLocks?: BossLockState[]; bossPreparations?: BossPreparationState[]; }
export interface Snapshot { type: 'snapshot'; tick: number; time: number; ack: number; self: Actor; actors: Actor[]; projectiles: Projectile[]; pickups: Pickup[]; traps?: Trap[]; events: GameEvent[]; online: number; activeChunks: number; arenaGate?: ArenaGateState; matchEndsAt?: number; sanctuary?: 'safe' | 'combat' | 'outside'; }

export type ClientMessage =
  | {
      type: 'hello';
      protocol: number;
      classId: ClassId;
      token?: string;
      name?: string;
      password?: string;
      mode?: 'login' | 'register';
    }
  | { type: 'input'; input: InputCommand; roomId: string; epoch: number }
  | { type: 'leave' }
  | { type: 'ping'; at: number }
  | {
      type: 'social';
      action:
        | 'friend-request'
        | 'friend-accept'
        | 'friend-decline'
        | 'friend-remove'
        | 'team-invite'
        | 'team-accept'
        | 'team-decline'
        | 'team-leave';
      targetId?: string;
    };

export type ServerMessage =
  | { type: 'welcome'; token: string; account: PublicAccount; playerId: string; seed: number; tickRate: number; time: number; social: SocialState }
  | { type: 'room'; room: RoomState }
  | Snapshot
  | { type: 'social'; state: SocialState }
  | { type: 'pong'; at: number; time: number }
  | { type: 'notice'; message: string; tone: 'info' | 'error' | 'success' }
  | { type: 'error'; message: string; fatal?: boolean; authExpired?: boolean };
