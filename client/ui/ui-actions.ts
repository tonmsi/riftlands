import type { ControlSettings } from '../controls/controls';
import type { InteractionCommand } from '../../shared/interactions';
import type { AbilitySlot, ClassId, ClientMessage } from '../../shared/types';
export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline';
export type SocialAction = Extract<ClientMessage, { type: 'social' }>['action'];

export interface UIActions {
  interact?: (command: InteractionCommand) => void;
  joinCredentials: (mode: 'login' | 'register', name: string, password: string, classId: ClassId) => void;
  joinSaved: (classId: ClassId) => void;
  logout: () => void;
  leave: () => void;
  social: (action: SocialAction, targetId?: string) => void;
  select: (id: string | null) => void;
  cast: (slot: AbilitySlot) => void;
  previewClass?: (classId: ClassId) => void;
  controlsChanged?: (settings: ControlSettings) => void;
  releaseControls?: () => void;
  lobbyToken?: () => string | undefined;
}

export type LobbyActions = Pick<UIActions, 'joinCredentials' | 'joinSaved' | 'logout' | 'previewClass' | 'lobbyToken'>;
export type HudActions = Pick<UIActions, 'interact' | 'leave' | 'social' | 'select' | 'cast' | 'releaseControls'>;
export type SocialActions = Pick<UIActions, 'social' | 'select'>;

