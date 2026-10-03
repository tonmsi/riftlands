import type { ControlSettings } from './controls';
import { ControlOptions } from './control-options';
import { HudUI } from './hud-ui';
import { LobbyUI } from './lobby-ui';
import { PopupManager } from './popups';
import { WorldEntrance } from './world-entrance';
import { mountGameLayout } from './ui-layout';
import type { UIActions, ConnectionStatus } from './ui-actions';
import type { LobbyArt } from './lobby-assets';
import type { Actor, ClassId, PublicAccount, Snapshot, SocialState } from '../shared/types';
export type { UIActions } from './ui-actions';
export { PROFILE_URLS } from './ui-art';

/** Public presentation API. Views own their state; this facade coordinates transitions. */
export class GameUI {
  private readonly matchResultStatus = document.createElement('div');
  announceMatchResult(text: string): void { this.hud.dismissPopups(); this.matchResultStatus.textContent = text; }
  private readonly hud: HudUI;
  private readonly lobby: LobbyUI;
  private readonly entrance: WorldEntrance;
  private readonly options: ControlOptions;
  private isPlaying = false;
  private status: ConnectionStatus = 'idle';
  constructor(root: HTMLElement, actions: UIActions) {
    mountGameLayout(root);
    this.matchResultStatus.className = 'match-result-status';
    this.matchResultStatus.setAttribute('role', 'status');
    this.matchResultStatus.setAttribute('aria-live', 'assertive');
    this.matchResultStatus.setAttribute('aria-atomic', 'true');
    root.append(this.matchResultStatus);
    const popups = new PopupManager(root);
    this.entrance = new WorldEntrance(root, {
      prepare: () => { this.options.close(); actions.releaseControls?.(); },
      changed: () => this.lobby.updateJoinAvailability(),
      completed: () => { if (this.isPlaying) this.canvas.focus({ preventScroll: true }); },
    });
    this.hud = new HudUI(root, actions, popups, { entranceVisible: () => this.entrance.visible });
    this.options = new ControlOptions(root, () => !this.isPlaying && this.status !== 'connecting' && this.status !== 'reconnecting', settings => {
      this.setControls(settings); actions.controlsChanged?.(settings);
    });
    popups.register(this.options.dialog, () => this.options.dialog.open, () => this.options.close());
    this.lobby = new LobbyUI(root, actions, {
      configureControls: settings => this.options.open(settings),
      enterWorld: art => { this.hud.enterFullscreen(); this.entrance.start(art); },
      entranceVisible: () => this.entrance.visible,
      resetJournal: () => this.hud.resetJournal(),
      updateJournal: progress => this.hud.updateJournal(progress),
      isTouch: () => this.hud.touch,
      toast: (message, tone) => this.toast(message, tone),
    });
    root.querySelector('[data-ref="entrance-cancel"]')!.addEventListener('click', () => actions.leave());
  }
  get canvas(): HTMLCanvasElement { return this.hud.canvas; }
  get minimap(): HTMLCanvasElement { return this.hud.minimap; }
  get compactMinimap(): HTMLCanvasElement { return this.hud.compactMinimap; }
  get interactions() { return this.hud.interactions; }
  get selectedClass(): ClassId { return this.lobby.selectedClass; }
  get minimapVisible(): boolean { return this.hud.minimapVisible; }
  get inputBlocked(): boolean { return this.hud.inputBlocked; }
  setControls(settings: ControlSettings): void {
    if (this.isPlaying) return;
    this.lobby.setControls(settings); this.hud.setControls(settings);
  }
  setAuthMode(mode: 'login' | 'register'): void { this.lobby.setAuthMode(mode); }
  setSavedAccount(account: PublicAccount | null): void { this.lobby.setSavedAccount(account); }
  setLobbyArt(art: LobbyArt): Promise<void> { return this.lobby.setLobbyArt(art); }
  setAssetProgress(done: number, total: number, failed: number): void { this.lobby.setAssetProgress(done, total, failed); }
  setConnection(status: ConnectionStatus, detail?: string): void {
    this.status = status;
    if (status === 'connecting' || status === 'reconnecting') this.options.close();
    if (status === 'offline') this.entrance.cancel();
    if (status === 'reconnecting') this.entrance.setReady(false);
    this.lobby.setConnection(status, detail); this.hud.setConnection(status, detail);
  }
  setPlaying(playing: boolean): void {
    this.isPlaying = playing;
    if (!playing) this.entrance.cancel();
    if (playing) this.options.close();
    this.hud.setPlaying(playing); this.lobby.setPlaying(playing);
  }
  setSnapshot(snapshot: Snapshot, ping: number): void {
    if (this.entrance.visible) this.entrance.setReady(true);
    this.hud.setSnapshot(snapshot, ping); this.lobby.setGold(snapshot.gold ?? 0);
  }
  setSocial(state: SocialState): void { this.hud.setSocial(state); }
  setSelected(actor: Actor | null): void { this.hud.setSelected(actor); }
  setLocation(biome: string): void { this.hud.setLocation(biome); }
  toast(message: string, tone: 'info' | 'error' | 'success' = 'info'): void { this.hud.toast(message, tone); }
}
