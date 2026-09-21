import { CLASSES, levelFromXp } from '../shared/config';
import { ARENA_GATE } from '../shared/arena';
import { bindingLabel, defaultControls, type ControlSettings } from './controls';
import { ControlOptions } from './control-options';
import { GameDisplay } from './game-display';
import type { AbilitySlot, Actor, ClassId, ClientMessage, PublicAccount, Snapshot, SocialState } from '../shared/types';

const PROFILE_URLS: Partial<Record<ClassId, string>> = {
  paladin: new URL('../assets/paladinoProfile.png', import.meta.url).href,
  mage: new URL('../assets/mageProfile.png', import.meta.url).href,
  warrior: new URL('../assets/warriorProfile.png', import.meta.url).href,
};

type SocialAction = Extract<ClientMessage, { type: 'social' }>['action'];

export interface UIActions {
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
}

const SLOTS: AbilitySlot[] = ['basic', 'q', 'e', 'r'];
const CLASS_ICONS: Record<ClassId, string> = {
  mage: '<path d="M12 2 14.7 9.3 22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7Z"/><path d="m19 2 1 3 3 1M3 19l-1 3"/>',
  warrior: '<path d="m5 3 4 1 10 12-3 3L4 7Z"/><path d="m19 3-4 1-4 5M5 16l4-4M3 17l4 4M17 15l4 4M5 19l-2 3M19 19l3 3"/>',
  paladin: '<path d="m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5Z"/><path d="M12 6v11M8 10h8"/>',
  hunter: '<path d="M12 2v20M17 5l-5-3-5 3M12 2l-7 7v6l7 7M5 12h14"/>',
};
const ABILITY_ICONS: Record<string, string> = {
  projectile: '<path d="m4 20 8-8M3 14l5-5M10 21l5-5M13 4l7-1-1 7-7 3-3-3Z"/>',
  melee: '<path d="m5 3 4 1 11 12-4 4L4 8ZM12 18l6-6M5 19l3-3M3 21l3-3"/>',
  area: '<circle cx="12" cy="12" r="4"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4 4l3 3M17 17l3 3M4 20l3-3M17 7l3-3"/>',
  heal: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"/>',
  shield: CLASS_ICONS.paladin,
  dash: '<path d="m11 3 9 9-9 9M3 6l6 6-6 6M6 12h14"/>',
  trap: '<circle cx="12" cy="12" r="8"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8"/>',
};

function icon(paths: string, extra = ''): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${paths}</svg>`;
}

function portrait(classId: ClassId): string {
  const profileUrl = PROFILE_URLS[classId];
  if (profileUrl) {
    return `<img class="player-profile-image" src="${profileUrl}" alt="" onerror="this.hidden=true;this.nextElementSibling?.removeAttribute('hidden')">${icon(CLASS_ICONS[classId], 'hidden')}`;
  }
  return icon(CLASS_ICONS[classId]);
}

function textElement(tag: string, className: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

export class GameUI {
  public readonly canvas: HTMLCanvasElement;
  public readonly minimap: HTMLCanvasElement;
  private currentClass: ClassId = 'mage';
  private activeClass: ClassId | null = null;
  private selected: Actor | null = null;
  private latest: Snapshot | null = null;
  private socialState: SocialState | null = null;
  private status = 'idle';
  private isPlaying = false;
  private socialCache = '';
  private authMode: 'login' | 'register' = 'login';
  private savedAccount: PublicAccount | null = null;
  private readonly refs = new Map<string, HTMLElement>();
  private readonly nameInput: HTMLInputElement;
  private readonly passwordInput: HTMLInputElement;
  private readonly arenaStatus = document.createElement('div');
  private readonly goldWallet: HTMLElement;
  private controls = defaultControls();
  private readonly options: ControlOptions;
  private readonly display: GameDisplay;
  private readonly exitDialog = document.createElement('dialog');
  private readonly mapToggle = document.createElement('button');
  private mapVisible = true;
  private lobbyRequest = 0;
  private inviteKey = '';
  private rosterKey = '';
  private readonly inviteCooldowns = new Map<string, number>();

  constructor(private root: HTMLElement, private actions: UIActions) {
    root.className = 'rift-app';
    root.innerHTML = `
      <div class="world-stage"><canvas class="world-canvas" aria-label="Mondo di gioco multiplayer" tabindex="0"></canvas>
      </div>
      <div class="lobby">
        <header class="site-header"><a class="brand" href="/" aria-label="Riftlands, ingresso"><span class="brand-symbol">${icon('<path d="m12 1 10 11-10 11L2 12Z"/><path d="m12 5 6 7-6 7-6-7ZM12 1v22"/>')}</span>RIFTLANDS</a><div class="header-right"><a href="/dungeon-maker.html">Dungeon maker</a><span class="connection-pill" data-ref="lobby-connection"><i></i><span>Pronto a esplorare</span></span></div></header>
        <main class="lobby-main"><section class="entry-panel" aria-label="Menu principale">
          <div class="intro"><span class="eyebrow">IL TUO ACCAMPAMENTO</span><h1>Prepara la tua avventura</h1><p>Scegli il campione e torna nelle Terre di Soglia.</p></div>
          
          <form data-ref="entry-form" class="entry-form">
            <!-- SCHERMATA SESSIONE ATTIVA -->
            <div class="saved-account-card" data-ref="saved-card" hidden>
              <div class="account-icon">${icon('<circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>')}</div>
              <div class="saved-info">
                <span class="saved-label">SESSIONE ATTIVA</span>
                <strong data-ref="saved-name">Viaggiatore</strong>
                <small data-ref="saved-stats">Livello 1</small>
              </div>
              <div class="saved-gold" title="Gold raccolti">${icon('<circle cx="12" cy="12" r="8"/><path d="M14.8 8.7a4.5 4.5 0 1 0 0 6.6M9 10h5M9 14h5"/>')}<strong data-ref="lobby-gold">0</strong></div>
              <button type="button" class="change-account-btn" data-ref="change-account-btn">Cambia</button>
            </div>

            <!-- SCHERMATA LOGIN / REGISTRAZIONE -->
            <div class="auth-box" data-ref="auth-box">
              <div class="auth-tabs" role="tablist">
                <button type="button" class="auth-tab active" data-ref="tab-login" role="tab" aria-selected="true">Accedi</button>
                <button type="button" class="auth-tab" data-ref="tab-register" role="tab" aria-selected="false">Registrati</button>
              </div>

              <div class="account-card auth-inputs">
                <div class="account-icon">${icon('<circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>')}</div>
                <div class="inputs-column">
                  <label class="name-label">
                    <span data-ref="name-heading">NOME PERSONAGGIO</span>
                    <input data-ref="name" type="text" maxlength="20" placeholder="Nome univoco…" autocomplete="username" required>
                  </label>
                  <label class="password-label">
                    <span>PASSWORD</span>
                    <input data-ref="password" type="password" maxlength="100" placeholder="Almeno 4 caratteri…" autocomplete="current-password" required>
                  </label>
                </div>
              </div>
            </div>

            <div class="section-label"><b>Scegli il campione</b><span>Tutti disponibili</span></div>
            <div class="class-choices" role="group" aria-label="Campione">${(Object.keys(CLASSES) as ClassId[]).map(id => `<button type="button" class="class-card ${id === 'mage' ? 'selected' : ''}" data-class="${id}" aria-pressed="${id === 'mage'}" style="--class-color:${CLASSES[id].color}"><span class="class-symbol">${portrait(id)}</span><span class="class-name">${CLASSES[id].name}</span><span class="class-role">${id === 'mage' ? 'DISTANZA · CONTROLLO' : id === 'warrior' ? 'MISCHIA · ASSALTO' : id === 'hunter' ? 'DISTANZA · TRAPPOLE' : 'DIFESA · SUPPORTO'}</span><span class="selection-dot"></span></button>`).join('')}</div>
            <div class="class-detail" data-ref="class-detail"></div>
            
            <button type="submit" class="join-button" data-ref="join">
              <span data-ref="join-text">Entra nel mondo</span><span class="join-arrow">↗</span>
            </button>
            <div class="entry-note"><span class="save-dot"></span>I tuoi progressi sono protetti dal tuo account personale.</div>
          </form>

          <div class="lobby-controls"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Muoviti</span><span><kbd>␣</kbd> Attacca</span><span><kbd>Q</kbd><kbd>E</kbd><kbd>R</kbd> Abilità</span><span class="mouse-hint">↖ Tieni il sinistro per mirare</span></div>
        </section></main>
        <section class="lobby-hub" aria-label="Il tuo profilo">
          <nav class="hub-nav" aria-label="Sezioni del menu">
            <button type="button" data-hub="friends" aria-pressed="true">Amici</button>
            <button type="button" data-hub="rankings" aria-pressed="false">Classifiche</button>
            <button type="button" data-hub="stats" aria-pressed="false">Statistiche</button>
            <button type="button" data-hub="achievements" aria-pressed="false">Achievement</button>
          </nav>
          <div class="hub-panel" data-hub-panel="friends"><h2>I tuoi amici</h2><div data-ref="lobby-friends">Accedi per vedere i tuoi amici.</div></div>
          <div class="hub-panel" data-hub-panel="rankings" hidden><h2>Classifica esperienza</h2><p>I primi 20 giocatori, ordinati per XP.</p><ol data-ref="lobby-rankings"></ol></div>
          <div class="hub-panel" data-hub-panel="stats" hidden><h2>Le tue statistiche</h2><div data-ref="lobby-stats">Accedi per vedere i tuoi progressi.</div></div>
          <div class="hub-panel" data-hub-panel="achievements" hidden><h2>I tuoi achievement</h2><span class="coming-soon">In arrivo</span><p>Qui troverai i traguardi del tuo viaggio quando saranno disponibili.</p></div>
          <div class="hub-status"><span data-ref="lobby-data-status" role="status"></span><button type="button" data-ref="refresh-lobby">Aggiorna</button></div>
        </section>
      </div>
      <div class="game-hud" hidden>
        <section class="player-panel glass"><div class="player-portrait" data-ref="portrait"></div><div class="player-vitals"><div class="player-name-row"><strong data-ref="player-name"></strong><span data-ref="player-level">LV 1</span><span class="player-network"><span data-ref="online" title="Giocatori online">1</span><i class="network-dot" aria-hidden="true"></i><span data-ref="ping">— ms</span></span></div><div class="vital-row"><span>HP</span><div class="meter hp-meter"><i data-ref="hp-fill"></i><span data-ref="hp-label"></span></div></div><div class="vital-row"><span data-ref="resource-name">MP</span><div class="meter resource-meter"><i data-ref="resource-fill"></i><span data-ref="resource-label"></span></div></div><div class="xp-meter"><i data-ref="xp-fill"></i></div></div></section>
        <div class="world-location glass"><span class="location-dot"></span><div><strong data-ref="biome">Terre di Soglia</strong></div><span class="location-decoration">✦</span></div>
        <div class="game-top-right"><div class="status-row"><div class="gold-counter glass" title="Gold raccolti">${icon('<circle cx="12" cy="12" r="8"/><path d="M14.8 8.7a4.5 4.5 0 1 0 0 6.6M9 10h5M9 14h5"/>')}<b data-ref="hud-gold">0</b></div></div><div class="menu-buttons"><button type="button" class="glass hud-menu-button settings-toggle" data-ref="settings-toggle" aria-label="Impostazioni" title="Impostazioni" aria-expanded="false" aria-controls="game-settings">${icon('<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>')}</button><button class="glass hud-menu-button" data-ref="social-toggle" aria-expanded="false">${icon('<circle cx="8" cy="8" r="3"/><path d="M2 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 4 5v2"/>')}<span>Compagni</span><i class="notification-dot" data-ref="social-dot" hidden></i></button></div></div>
        <aside id="game-settings" class="settings-panel glass" data-ref="settings-panel" aria-label="Impostazioni" hidden><div class="settings-actions"><button class="glass hud-menu-button" data-ref="leave" title="Torna al menu" aria-label="Torna al menu">${icon('<path d="M10 3H3v18h7M8 12h14M17 7l5 5-5 5"/>')}<span>Esci</span></button></div></aside><div class="effect-list" data-ref="effects"></div>
        <aside class="team-invite glass" data-ref="team-invite" aria-label="Invito al team" hidden></aside>
        <div class="player-details" data-ref="player-details" role="region" aria-label="Compagni del team" tabindex="0"><section class="team-roster glass" data-ref="team-roster" aria-label="Membri del team" hidden></section></div>
        <section class="target-panel glass" data-ref="target" hidden><div class="target-heading"><span data-ref="target-type">GIOCATORE</span><button data-ref="target-close" aria-label="Deseleziona bersaglio">×</button></div><strong data-ref="target-name"></strong><small data-ref="target-detail"></small><div class="meter hp-meter target-health"><i data-ref="target-fill"></i></div><div class="target-actions" data-ref="target-actions"><button data-ref="target-friend">+ Amico</button><button data-ref="target-team">+ Team</button></div></section>
        <aside class="social-panel glass" data-ref="social-panel" hidden><div class="social-header"><div><span class="eyebrow">NON VIAGGIARE DA SOLO</span><h2>I tuoi compagni</h2></div><button data-ref="social-close" aria-label="Chiudi compagni">×</button></div><div class="social-content" data-ref="social-content"></div></aside>
        <div class="map-dismiss" data-ref="map-dismiss" hidden aria-hidden="true"></div>
        <div class="minimap-panel glass"><header class="map-heading"><span>LE TERRE DI SOGLIA</span><strong data-ref="map-location">Terre di Soglia</strong></header><canvas class="minimap" width="260" height="260" aria-label="Mappa locale"></canvas><div><span>MAPPA LOCALE</span><span>N ↑</span></div></div>
        <div class="combat-hud"><div class="combat-instruction"><span>WASD / FRECCE <b>muovi</b></span><span>SINISTRO PREMUTO <b>mira</b></span><span>CLIC <b>seleziona</b></span></div><div class="ability-bar glass" data-ref="ability-bar"></div><div class="combat-caption"><span data-ref="combat-class"></span><span>·</span><span>SPAZIO / CLIC DESTRO per attaccare</span></div></div>
        <div class="world-tip glass"><span>✧</span><span>I cespugli ti nascondono.<br><b>Attaccare rivela la tua posizione.</b></span></div>
        <div class="connection-banner" data-ref="connection-banner" hidden>Riconnessione al mondo…</div>
        <div class="death-overlay" data-ref="death" hidden><span class="eyebrow">IL VIAGGIO NON FINISCE QUI</span><h2>La Soglia ti richiama.</h2><p>Ritorno al punto di partenza tra <b data-ref="death-count">5</b> secondi</p></div>
      </div>
      <div class="toast-stack" data-ref="toasts" aria-live="polite" aria-atomic="false"></div>`;

    root.querySelectorAll<HTMLElement>('[data-ref]').forEach(element => this.refs.set(element.dataset.ref!, element));
    const rightColumn = document.createElement('div');
    rightColumn.className = 'right-hud-column';
    rightColumn.append(this.ref('target'), root.querySelector('.game-top-right')!);
    root.querySelector('.game-hud')!.append(rightColumn);
    const mapStatus = textElement('small', 'map-status', '');
    this.refs.set('map-status', mapStatus);
    root.querySelector('.map-heading')!.append(mapStatus);
    this.arenaStatus.className = 'arena-status';
    this.arenaStatus.setAttribute('role', 'status');
    root.append(this.arenaStatus);
    this.goldWallet = this.ref('hud-gold');
    this.canvas = root.querySelector<HTMLCanvasElement>('.world-canvas')!;
    this.minimap = root.querySelector<HTMLCanvasElement>('.minimap')!;
    this.nameInput = this.ref('name') as HTMLInputElement;
    this.passwordInput = this.ref('password') as HTMLInputElement;
    this.display = new GameDisplay(root, () => this.actions.releaseControls?.(), () => this.confirmLeave(), message => this.toast(message));
    this.exitDialog.className = 'control-options exit-confirmation';
    this.exitDialog.setAttribute('aria-labelledby', 'exit-title');
    this.exitDialog.innerHTML = '<h2 id="exit-title">Tornare al menu?</h2><p>Il personaggio resta nel mondo per 20 secondi dopo l’uscita.</p><div class="options-footer"><button type="button" data-resume>Continua a giocare</button><button type="button" data-exit>Torna al menu</button></div>';
    root.append(this.exitDialog);
    this.exitDialog.querySelector('[data-resume]')!.addEventListener('click', () => { this.exitDialog.close(); this.display.resume(); });
    this.exitDialog.querySelector('[data-exit]')!.addEventListener('click', () => { this.exitDialog.close(); this.actions.leave(); });
    this.exitDialog.addEventListener('cancel', () => this.display.resume());
    this.mapVisible = !this.display.touch;
    try { const saved = localStorage.getItem('riftlands.minimap'); if (saved !== null) this.mapVisible = saved === 'visible'; } catch { /* Device preference is optional. */ }
    const mapPanel = root.querySelector<HTMLElement>('.minimap-panel')!; mapPanel.id = 'game-minimap';
    this.mapToggle.type = 'button'; this.mapToggle.className = 'world-location glass map-toggle';
    const location = root.querySelector('.world-location')!;
    this.mapToggle.append(...Array.from(location.childNodes));
    location.remove();
    root.querySelector('.menu-buttons')!.prepend(this.mapToggle);
    this.mapToggle.setAttribute('aria-controls', mapPanel.id);
    this.mapToggle.addEventListener('click', () => {
      this.setMapVisible(!this.mapVisible);
    });
    this.ref('map-dismiss').addEventListener('pointerdown', event => {
      if (!this.display.touch || !this.mapVisible) return;
      event.preventDefault(); event.stopPropagation();
      this.setMapVisible(false);
    });
    this.updateMap();
    this.ref('leave').setAttribute('aria-label', 'Torna al menu');
    this.ref('social-toggle').setAttribute('aria-label', 'Compagni');
    this.options = new ControlOptions(root, () => !this.isPlaying && this.status !== 'connecting' && this.status !== 'reconnecting', settings => {
      this.setControls(settings); this.actions.controlsChanged?.(settings);
    });
    const optionsButton = document.createElement('button'); optionsButton.type = 'button';
    optionsButton.className = 'options-button'; optionsButton.textContent = 'Opzioni';
    optionsButton.addEventListener('click', () => this.options.open(this.controls));
    root.querySelector('.header-right')!.prepend(optionsButton);

    root.querySelectorAll<HTMLButtonElement>('[data-hub]').forEach(button => button.addEventListener('click', () => {
      root.querySelectorAll<HTMLButtonElement>('[data-hub]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
      root.querySelectorAll<HTMLElement>('[data-hub-panel]').forEach(panel => { panel.hidden = panel.dataset.hubPanel !== button.dataset.hub; });
      void this.refreshLobby();
    }));
    this.ref('refresh-lobby').addEventListener('click', () => void this.refreshLobby());
    void this.refreshLobby();

    this.ref('tab-login').addEventListener('click', () => this.setAuthMode('login'));
    this.ref('tab-register').addEventListener('click', () => this.setAuthMode('register'));
    this.ref('change-account-btn').addEventListener('click', () => {
      this.actions.logout();
      this.setSavedAccount(null);
    });

    this.ref('entry-form').addEventListener('submit', event => {
      event.preventDefault();
      if (this.status === 'connecting') return;

      if (this.savedAccount) {
        if (this.display.touch) void this.display.enterFullscreen();
        this.actions.joinSaved(this.currentClass);
        return;
      }

      const name = this.nameInput.value.trim();
      const password = this.passwordInput.value;
      if (!name || !password) {
        this.toast('Compila nome e password per procedere.', 'error');
        return;
      }
      if (this.display.touch) void this.display.enterFullscreen();
      this.actions.joinCredentials(this.authMode, name, password, this.currentClass);
    });

    root.querySelectorAll<HTMLButtonElement>('[data-class]').forEach(button => button.addEventListener('click', () => {
      this.currentClass = button.dataset.class as ClassId;
      this.renderClass();
      this.actions.previewClass?.(this.currentClass);
    }));

    this.ref('leave').addEventListener('click', () => { if (this.display.touch) this.confirmLeave(); else this.actions.leave(); });
    this.ref('settings-toggle').addEventListener('click', () => this.toggleSettings());
    document.addEventListener('pointerdown', event => {
      const target = event.target as Node;
      if (!this.ref('settings-panel').contains(target) && !this.ref('settings-toggle').contains(target)) this.toggleSettings(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !this.ref('settings-panel').hidden) { this.toggleSettings(false); this.ref('settings-toggle').focus(); }
    });
    this.ref('social-toggle').addEventListener('click', () => this.toggleSocial());
    this.ref('social-close').addEventListener('click', () => this.toggleSocial(false));
    const targetSummary = document.createElement('button');
    targetSummary.type = 'button';
    targetSummary.className = 'target-summary';
    targetSummary.setAttribute('aria-expanded', 'false');
    targetSummary.innerHTML = '<strong></strong><span class="target-summary-meter target-summary-hp"><i></i><span></span></span><span class="target-summary-meter target-summary-resource"><i></i><span></span></span>';
    this.ref('target').prepend(targetSummary);
    targetSummary.addEventListener('click', () => {
      const expanded = this.ref('target').classList.toggle('is-expanded');
      targetSummary.setAttribute('aria-expanded', String(expanded));
      this.actions.releaseControls?.();
    });
    this.ref('target-close').addEventListener('click', () => this.actions.select(null));
    this.ref('target-friend').addEventListener('click', () => { if (this.selected) this.actions.social('friend-request', this.selected.id); });
    this.ref('target-team').addEventListener('click', () => { if (this.selected) this.sendSocial('team-invite', this.selected.id); });

    this.ref('ability-bar').addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-slot]');
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !this.inputBlocked) this.actions.cast(button.dataset.slot as AbilitySlot);
    });

    this.renderClass();
  }

  get selectedClass(): ClassId { return this.currentClass; }
  get minimapVisible(): boolean { return this.mapVisible; }
  get inputBlocked(): boolean { return !this.ref('settings-panel').hidden || this.exitDialog.open || !this.ref('social-panel').hidden || (this.display.touch && this.mapVisible); }
  private toggleSettings(open = this.ref('settings-panel').hidden): void {
    this.ref('settings-panel').hidden = !open;
    this.ref('settings-toggle').setAttribute('aria-expanded', String(open));
    if (open) this.actions.releaseControls?.();
  }
  private setMapVisible(visible: boolean): void {
    this.mapVisible = visible;
    if (visible && this.display.touch) this.actions.releaseControls?.();
    this.updateMap();
    try { localStorage.setItem('riftlands.minimap', visible ? 'visible' : 'hidden'); } catch { /* Ignore storage restrictions. */ }
  }
  private updateMap(): void {
    this.root.classList.toggle('map-open', this.mapVisible);
    this.root.querySelector<HTMLElement>('.minimap-panel')!.hidden = !this.mapVisible;
    this.mapToggle.setAttribute('aria-expanded', String(this.mapVisible));
    this.mapToggle.setAttribute('aria-label', this.mapVisible ? 'Nascondi mappa' : 'Mostra mappa');
    this.mapToggle.title = this.mapVisible ? 'Nascondi mappa' : 'Mostra mappa';
    this.ref('map-dismiss').hidden = !this.mapVisible;
  }
  private confirmLeave(): void {
    if (!this.isPlaying || this.exitDialog.open) return;
    this.actions.releaseControls?.(); this.exitDialog.showModal();
  }
  private keyLabel(slot: AbilitySlot): string { return bindingLabel(this.controls.bindings[slot][0]); }
  setControls(settings: ControlSettings): void {
    if (this.isPlaying) return;
    this.controls = structuredClone(settings); this.activeClass = null; this.renderClass();
    const movement = settings.movement === 'mouse'
      ? `${settings.bindings.movePointer.map(bindingLabel).join(' / ')} tenuto: segui il cursore`
      : `${(['up', 'left', 'down', 'right'] as const).map(action => settings.bindings[action].map(bindingLabel).join('/')).join(' · ')}: muovi`;
    this.root.querySelector('.lobby-controls')!.textContent = this.display.touch
      ? 'Joystick: muovi · Trascina le abilità direzionali per mirare, rilascia per usarle · Tocca per mirare al nemico più vicino · Tocca i personaggi per selezionarli'
      : `${movement} · ${settings.bindings.basic.map(bindingLabel).join(' / ')}: attacca · ${(['q', 'e', 'r'] as const).map(slot => this.keyLabel(slot)).join(' / ')}: abilità · Sinistro premuto: mira manuale · Senza mira: nemico più vicino`;
    this.root.querySelector('.combat-instruction')!.textContent = `${movement} · Sinistro premuto: mira manuale · Senza mira: nemico più vicino · Clic sinistro: seleziona`;
    this.root.querySelector('.combat-caption > span:last-child')!.textContent = `${settings.bindings.basic.map(bindingLabel).join(' / ')} per attaccare`;
  }
  private ref(name: string): HTMLElement { return this.refs.get(name)!; }
  private write(name: string, value: string): void { const node = this.ref(name); if (node.textContent !== value) node.textContent = value; }
  private fill(name: string, fraction: number): void { this.ref(name).style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`; }

  setAuthMode(mode: 'login' | 'register'): void {
    this.authMode = mode;
    const isLogin = mode === 'login';
    this.ref('tab-login').classList.toggle('active', isLogin);
    this.ref('tab-login').setAttribute('aria-selected', String(isLogin));
    this.ref('tab-register').classList.toggle('active', !isLogin);
    this.ref('tab-register').setAttribute('aria-selected', String(!isLogin));
    this.ref('name-heading').textContent = isLogin ? 'NOME PERSONAGGIO' : 'SCEGLI IL TUO NOME';
    this.write('join-text', isLogin ? 'Accedi ed entra' : 'Crea personaggio ed entra');
    this.passwordInput.autocomplete = isLogin ? 'current-password' : 'new-password';
  }

  setSavedAccount(account: PublicAccount | null): void {
    const changed = this.savedAccount?.id !== account?.id;
    this.savedAccount = account;
    this.renderLobbyStats();
    if (changed) void this.refreshLobby();
    const hasSaved = Boolean(account);
    this.ref('saved-card').hidden = !hasSaved;
    this.ref('auth-box').hidden = hasSaved;

    if (hasSaved && account) {
      this.write('saved-name', account.name);
      this.write('saved-stats', `Livello ${levelFromXp(account.xp)} · ${account.kills} uccisioni`);
      this.write('lobby-gold', String(account.gold ?? 0));
      this.write('join-text', 'Entra nel mondo');
      this.nameInput.removeAttribute('required');
      this.passwordInput.removeAttribute('required');
    } else {
      this.write('join-text', this.authMode === 'login' ? 'Accedi ed entra' : 'Crea personaggio ed entra');
      this.nameInput.setAttribute('required', 'true');
      this.passwordInput.setAttribute('required', 'true');
      this.passwordInput.value = '';
    }
  }

  private renderLobbyStats(): void {
    const container = this.ref('lobby-stats');
    container.replaceChildren();
    if (!this.savedAccount) { container.textContent = 'Accedi per vedere i tuoi progressi.'; return; }
    const a = this.savedAccount;
    const grid = document.createElement('dl'); grid.className = 'profile-stats';
    for (const [label, value] of [['Livello', levelFromXp(a.xp)], ['Esperienza', a.xp], ['Uccisioni', a.kills], ['Morti', a.deaths], ['Gold', a.gold ?? 0]]) {
      const item = document.createElement('div');
      item.append(textElement('dt', '', String(label)), textElement('dd', '', String(value))); grid.append(item);
    }
    container.append(grid);
  }

  private async refreshLobby(): Promise<void> {
    const request = ++this.lobbyRequest;
    let token: string | null = null;
    try { token = localStorage.getItem('riftlands.jwt'); } catch { /* Guest menu remains available. */ }
    this.write('lobby-data-status', 'Caricamento…');
    try {
      const response = await fetch('/api/lobby', { headers: token ? { Authorization: 'Bearer ' + token } : {}, signal: AbortSignal.timeout(8000) });
      if (request !== this.lobbyRequest) return;
      if (response.status === 401) {
        this.actions.logout();
        this.write('lobby-data-status', 'Sessione scaduta. Accedi di nuovo.');
        return;
      }
      if (!response.ok) throw new Error();
      const data = await response.json() as { account: PublicAccount | null; friends: SocialState['friends']; leaderboard: Pick<PublicAccount, 'id' | 'name' | 'xp' | 'kills'>[] };
      if (request !== this.lobbyRequest) return;
      if (data.account || this.savedAccount) this.setSavedAccount(data.account);
      const friends = this.ref('lobby-friends'); friends.replaceChildren();
      if (!data.account) friends.textContent = 'Accedi per vedere i tuoi amici.';
      else if (!data.friends.length) friends.textContent = 'Nessun amico ancora. Seleziona un giocatore nel mondo per aggiungerlo.';
      else data.friends.forEach(friend => {
        const row = textElement('div', 'hub-row', '');
        row.append(textElement('strong', '', friend.name), textElement('span', friend.online ? 'friend-online' : '', friend.online ? 'Online' : 'Offline')); friends.append(row);
      });
      const rankings = this.ref('lobby-rankings'); rankings.replaceChildren();
      if (!data.leaderboard.length) rankings.append(textElement('li', 'hub-row', 'La classifica è ancora vuota.'));
      data.leaderboard.forEach((player, index) => {
        const row = textElement('li', 'hub-row' + (player.id === data.account?.id ? ' is-self' : ''), '');
        row.append(textElement('strong', '', (index + 1) + '. ' + player.name), textElement('span', '', player.xp + ' XP · ' + player.kills + ' uccisioni')); rankings.append(row);
      });
      this.write('lobby-data-status', '');
    } catch {
      if (request === this.lobbyRequest) this.write('lobby-data-status', 'Dati non disponibili. Riprova con Aggiorna.');
    }
  }

  private renderClass(): void {
    const chosen = CLASSES[this.currentClass];
    this.root.style.setProperty('--selected-class', chosen.color);
    this.root.querySelectorAll<HTMLButtonElement>('[data-class]').forEach(button => {
      const active = button.dataset.class === this.currentClass;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    this.ref('class-detail').innerHTML = `<div class="class-detail-heading"><h3>${chosen.subtitle}</h3><div class="class-stats"><span><i class="stat-health"></i>${chosen.maxHp} PV</span><span><i class="stat-resource" style="background:${chosen.color}"></i>${chosen.maxResource} ${chosen.resource === 'rage' ? 'RAGE' : 'MANA'}</span></div></div><p>${chosen.description}</p><div class="lobby-abilities">${SLOTS.map(slot => `<div class="lobby-ability" title="${chosen.abilities[slot].description}"><kbd>${this.keyLabel(slot)}</kbd><span>${chosen.abilities[slot].name}</span></div>`).join('')}</div>`;
  }

  setConnection(status: 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline', detail?: string): void {
    this.status = status;
    if (status === 'connecting' || status === 'reconnecting') this.options.close();
    const optionsButton = this.root.querySelector<HTMLButtonElement>('.options-button');
    if (optionsButton) optionsButton.disabled = this.isPlaying || status === 'connecting' || status === 'reconnecting';
    const labels = { idle: 'Pronto a esplorare', connecting: 'Connessione in corso', online: 'Connesso al mondo', reconnecting: 'Riconnessione…', offline: 'Connessione interrotta' };
    const pill = this.ref('lobby-connection');
    pill.dataset.status = status;
    pill.querySelector('span')!.textContent = detail || labels[status];
    const button = this.ref('join') as HTMLButtonElement;
    button.disabled = status === 'connecting';
    const banner = this.ref('connection-banner');
    banner.hidden = !this.isPlaying || (status !== 'offline' && status !== 'reconnecting');
    banner.textContent = status === 'reconnecting'
      ? `Riconnessione al mondo…${detail ? ` ${detail}` : ''}`
      : detail || 'Connessione interrotta. Torna al menu per riprovare.';
  }

  setPlaying(playing: boolean): void {
    this.isPlaying = playing;
    this.toggleSettings(false);
    this.display.setPlaying(playing);
    if (!playing) this.exitDialog.close();
    if (playing) this.options.close();
    this.root.querySelector<HTMLButtonElement>('.options-button')!.disabled = playing || this.status === 'connecting' || this.status === 'reconnecting';
    this.root.classList.toggle('is-playing', playing);
    (this.root.querySelector('.lobby') as HTMLElement).hidden = playing;
    (this.root.querySelector('.game-hud') as HTMLElement).hidden = !playing;
    this.ref('connection-banner').hidden = true;
    if (playing) this.canvas.focus({ preventScroll: true });
    else {
      this.toggleSocial(false);
      this.setSelected(null);
      this.latest = null;
      this.activeClass = null;
      void this.refreshLobby();
      this.socialState = null;
      this.renderTeamInvite();
      this.renderTeamRoster();
    }
  }

  setSnapshot(snapshot: Snapshot, ping: number): void {
    this.latest = snapshot;
    const player = snapshot.self;
    const definition = CLASSES[player.classId];
    if (this.activeClass !== player.classId) {
      this.activeClass = player.classId;
      this.ref('portrait').innerHTML = portrait(player.classId);
      this.ref('portrait').style.color = definition.color;
      this.ref('resource-fill').style.background = definition.resource === 'rage' ? '#df9877' : '#aaa0e8';
      this.write('resource-name', definition.resource === 'rage' ? 'RG' : 'MP');
      this.write('combat-class', definition.name);
      this.ref('ability-bar').innerHTML = SLOTS.map(slot => {
        const ability = definition.abilities[slot];
        return `<button class="ability-button" data-slot="${slot}" style="--ability-color:${ability.color}" aria-label="${ability.name} (${this.keyLabel(slot)})" title="${ability.name} — ${ability.description}\n${ability.cost} ${definition.resource === 'rage' ? 'rabbia' : 'mana'} · ${ability.cooldown}s di recupero"><kbd>${this.keyLabel(slot)}</kbd><span class="ability-art">${icon(ABILITY_ICONS[ability.kind])}</span><span class="ability-name">${ability.name}</span><span class="ability-cost">${ability.cost || '—'}</span><span class="cooldown-shade"></span><span class="cooldown-count"></span></button>`;
      }).join('');
    }
    this.write('player-name', player.name);
    this.write('player-level', `LV ${player.level}`);
    this.fill('hp-fill', player.hp / player.maxHp);
    this.write('hp-label', `${Math.ceil(player.hp)} / ${player.maxHp}`);
    this.fill('resource-fill', player.resource / player.maxResource);
    this.write('resource-label', `${Math.floor(player.resource)} / ${player.maxResource}`);
    this.fill('xp-fill', (player.xp % 100) / 100);
    this.write('map-status', snapshot.sanctuary === 'safe' ? 'ZONA SICURA · NO PVP' : snapshot.sanctuary === 'combat' ? `VULNERABILE · ${Math.max(0, Math.ceil(((player.pvpUntil ?? 0) - snapshot.time) / 1000))}s` : snapshot.sanctuary === 'outside' ? 'PVP ATTIVO' : 'ISTANZA PVP');
    this.write('online', String(snapshot.online));
    const gold = snapshot.gold ?? 0;
    this.goldWallet.textContent = String(gold);
    this.write('lobby-gold', String(gold));
    const gate = snapshot.arenaGate;
    const bossPreparation = snapshot.bossPreparations?.[0];
    const worldTip = this.root.querySelector<HTMLElement>('.world-tip');
    if (worldTip) worldTip.hidden = !!snapshot.matchEndsAt || !player.hidden;
    let arenaText = Math.hypot(player.x - ARENA_GATE.x, player.y - ARENA_GATE.y) < ARENA_GATE.radius + 55 ? 'Arena 1v1 · Entra nel cerchio per partecipare' : '';
    if (bossPreparation) {
      const seconds = Math.max(0, (bossPreparation.endsAt - snapshot.time) / 1000).toFixed(1);
      const ready = `${bossPreparation.entrants} ${bossPreparation.entrants === 1 ? 'membro pronto' : 'membri pronti'}`;
      arenaText = bossPreparation.team ? `Battaglia con ${bossPreparation.name} · ${seconds} s · ${ready} · Entra nella regione prima della chiusura`
        : `Il dungeon si risveglia · ${bossPreparation.name} · ${seconds} s`;
    } else if (snapshot.matchEndsAt) {
      const seconds = Math.max(0, Math.ceil((snapshot.matchEndsAt - snapshot.time) / 1000));
      arenaText = `Duello 1v1 · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · Elimina l’avversario`;
    } else if (gate) {
      arenaText = gate.phase === 'countdown' ? `Preparazione arena · ${Math.max(0, (gate.startsAt! - snapshot.time) / 1000).toFixed(1)} s · Esci dal cerchio per annullare`
        : gate.phase === 'combat' ? 'Arena 1v1 · Occorre essere vivi e fuori combattimento da 10 secondi'
        : gate.phase === 'reenter' ? 'Per un nuovo duello, esci dal cerchio e rientra'
        : gate.phase === 'full' ? 'Arene occupate · Attendi nel cerchio'
        : `Arena 1v1 · ${gate.players}/2 pronti · In attesa di un avversario`;
    }
    if (this.arenaStatus.textContent !== arenaText) this.arenaStatus.textContent = arenaText;
    this.arenaStatus.hidden = !arenaText;
    this.arenaStatus.dataset.phase = bossPreparation ? 'boss-countdown' : gate?.phase ?? (snapshot.matchEndsAt ? 'match' : 'idle');
    this.write('ping', Number.isFinite(ping) ? `${Math.round(ping)} ms` : '— ms');

    const remaining = Math.max(0, player.deadUntil - snapshot.time);
    this.ref('death').hidden = remaining <= 0;
    this.write('death-count', String(Math.ceil(remaining / 1000)));

    this.root.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(button => {
      const slot = button.dataset.slot as AbilitySlot;
      const ability = definition.abilities[slot];
      const cooldown = Math.max(0, player.cooldowns[slot] - snapshot.time);
      const safeBlocked = snapshot.sanctuary === 'safe' && ability.kind !== 'heal' && ability.kind !== 'shield';
      const unavailable = cooldown > 0 || player.resource < ability.cost || remaining > 0 || safeBlocked;
      // Keep pointer capture alive while cooldown snapshots arrive during a touch gesture.
      button.disabled = unavailable && !this.display.touch;
      button.setAttribute('aria-disabled', String(unavailable));
      button.dataset.targeting = ability.targeting;
      button.setAttribute('aria-label', `${ability.name} (${this.display.touch ? ability.targeting === 'directional' ? 'trascina per mirare, rilascia per attaccare' : 'tocca per usare' : this.keyLabel(slot)})`);
      button.classList.toggle('on-cooldown', cooldown > 0);
      button.classList.toggle('low-resource', player.resource < ability.cost);
      (button.querySelector('.cooldown-shade') as HTMLElement).style.height = `${Math.min(100, cooldown / (ability.cooldown * 1000) * 100)}%`;
      button.querySelector('.cooldown-count')!.textContent = cooldown > 0 ? (cooldown < 1000 ? (cooldown / 1000).toFixed(1) : String(Math.ceil(cooldown / 1000))) : '';
    });

    const effectNames = { haste: 'Passo celere', power: 'Potere antico', weakness: 'Maledizione', slow: 'Rallentato', shield: 'Scudo attivo', root: 'Immobilizzato' };
    const effects = player.effects.filter(effect => effect.until > snapshot.time).map(effect => `${effectNames[effect.kind]} · ${Math.ceil((effect.until - snapshot.time) / 1000)}s`);
    if (player.hidden) effects.unshift('Nascosto nel cespuglio');
    if (player.spawnProtectedUntil > snapshot.time) effects.unshift('Protezione della Soglia');
    const effectText = effects.join('|');
    if (this.ref('effects').dataset.value !== effectText) {
      this.ref('effects').dataset.value = effectText;
      this.ref('effects').replaceChildren(...effects.map(effect => textElement('span', 'effect-chip', effect)));
    }
    if (this.selected) this.setSelected(snapshot.actors.find(actor => actor.id === this.selected!.id) || null);
    this.renderTeamRoster();
    this.updateInviteButtons();
  }

  setSocial(state: SocialState): void {
    this.socialState = state;
    this.ref('social-dot').hidden = !state.requests.length && !state.teamInvites.length;
    this.renderSocial();
    this.renderTeamInvite();
    this.renderTeamRoster();
    this.updateInviteButtons();
  }

  private renderTeamInvite(): void {
    const invites = this.socialState?.teamInvites ?? [];
    const invite = invites[0];
    const panel = this.ref('team-invite');
    panel.hidden = !invite;
    const key = JSON.stringify(invites);
    if (key === this.inviteKey) return;
    this.inviteKey = key;
    panel.replaceChildren();
    if (!invite) return;
    const message = textElement('p', '', `${invite.name} ti ha invitato nel suo team`);
    message.setAttribute('role', 'status');
    const actions = textElement('div', 'team-invite-actions', '');
    actions.append(this.socialButton('Accetta', 'team-accept', invite.id), this.socialButton('Rifiuta', 'team-decline', invite.id));
    panel.append(message, actions);
    if (invites.length > 1) panel.append(textElement('small', '', `Altri inviti in attesa: ${invites.length - 1}`));
  }

  private renderTeamRoster(): void {
    const team = this.socialState?.team;
    const self = this.latest?.self;
    const members = team && self ? team.members.filter(member => member.id !== self.id) : [];
    const roster = this.ref('team-roster');
    roster.hidden = !members.length;
    const key = JSON.stringify(members.map(member => [member.id, member.name]));
    if (key !== this.rosterKey) {
      this.rosterKey = key;
      roster.replaceChildren(textElement('h3', '', 'Il tuo team'));
      for (const member of members) {
        const row = textElement('button', 'team-member', '') as HTMLButtonElement;
        row.type = 'button';
        row.dataset.memberId = member.id;
        row.addEventListener('click', () => {
          if (this.latest?.actors.some(actor => actor.id === member.id)) this.actions.select(member.id);
        });
        const label = textElement('span', 'team-member-label', '');
        label.append(textElement('strong', '', member.name), textElement('span', 'team-member-health', ''));
        const meter = textElement('span', 'team-member-meter', '');
        meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', `Vita di ${member.name}`);
        meter.setAttribute('aria-valuemin', '0');
        meter.append(document.createElement('i'));
        row.append(label, meter); roster.append(row);
      }
    }
    for (const row of roster.querySelectorAll<HTMLButtonElement>('.team-member')) {
      const member = members.find(member => member.id === row.dataset.memberId)!;
      const actor = this.latest?.actors.find(actor => actor.id === member.id);
      const hp = actor?.hp ?? member.hp;
      const maxHp = actor?.maxHp ?? member.maxHp;
      const available = member.online && hp !== undefined && maxHp !== undefined && maxHp > 0;
      row.classList.toggle('is-offline', !member.online);
      row.disabled = !member.online || !actor;
      row.title = row.disabled ? `${member.name}: ${member.online ? 'fuori portata o in altra area' : 'offline'}` : `Seleziona ${member.name}`;
      row.setAttribute('aria-pressed', String(this.selected?.id === member.id));
      row.querySelector('.team-member-health')!.textContent = !member.online ? 'Offline' : available ? `${Math.ceil(hp!)} / ${Math.ceil(maxHp!)} PV` : 'In altra area';
      const meter = row.querySelector<HTMLElement>('.team-member-meter')!;
      meter.hidden = !available;
      if (available) {
        meter.setAttribute('aria-valuemax', String(maxHp)); meter.setAttribute('aria-valuenow', String(Math.max(0, hp!)));
        meter.querySelector('i')!.style.width = `${Math.max(0, Math.min(100, hp! / maxHp! * 100))}%`;
      }
    }
  }

  setSelected(actor: Actor | null): void {
    if (actor?.id === this.latest?.self.id) actor = null;
    const summary = this.ref('target').querySelector<HTMLButtonElement>('.target-summary')!;
    if (actor?.id !== this.selected?.id) {
      this.ref('target').classList.remove('is-expanded');
      summary.setAttribute('aria-expanded', 'false');
    }
    this.selected = actor;
    for (const row of this.ref('team-roster').querySelectorAll<HTMLElement>('.team-member')) {
      row.setAttribute('aria-pressed', String(row.dataset.memberId === actor?.id));
    }
    this.ref('target').hidden = !actor;
    if (!actor) return;
    summary.querySelector('strong')!.textContent = actor.name;
    const resourceName = CLASSES[actor.classId].resource === 'rage' ? 'Rage' : 'Mana';
    const updateSummaryMeter = (selector: string, value: number, max: number, label: string) => {
      const meter = summary.querySelector<HTMLElement>(selector)!;
      meter.querySelector('span')!.textContent = `${label} ${Math.ceil(value)} / ${max}`;
      meter.querySelector('i')!.style.width = `${max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0}%`;
    };
    updateSummaryMeter('.target-summary-hp', actor.hp, actor.maxHp, 'PV');
    updateSummaryMeter('.target-summary-resource', actor.resource, actor.maxResource, resourceName);
    summary.querySelector<HTMLElement>('.target-summary-resource')!.hidden = actor.maxResource <= 0;
    summary.style.setProperty('--target-resource-color', CLASSES[actor.classId].resource === 'rage' ? '#ac6043' : '#65549d');
    this.write('target-type', actor.kind === 'npc' ? 'CREATURA DEL MONDO' : 'VIAGGIATORE');
    this.write('target-name', actor.name);
    this.write('target-detail', `${CLASSES[actor.classId].name} · Livello ${actor.level} · ${Math.ceil(actor.hp)} / ${actor.maxHp} PV`);
    if (actor.npcKind === 'boss') this.write('target-detail', actor.hp <= 0 ? `Cadavere · Ritorna tra ${Math.max(0, Math.ceil((actor.deadUntil - (this.latest?.time ?? 0)) / 1000))}s` : `Boss · ${Math.ceil(actor.hp)} / ${actor.maxHp} PV`);
    this.fill('target-fill', actor.hp / actor.maxHp);
    this.ref('target-actions').hidden = actor.kind !== 'player';
    const isFriend = this.socialState?.friends.some(friend => friend.id === actor!.id);
    const sameTeam = !!actor.teamId && actor.teamId === this.latest?.self.teamId;
    (this.ref('target-friend') as HTMLButtonElement).disabled = !!isFriend;
    this.write('target-friend', isFriend ? '✓ Amico' : '+ Amico');
    const invited = (this.inviteCooldowns.get(actor.id) ?? 0) > Date.now();
    (this.ref('target-team') as HTMLButtonElement).disabled = sameTeam || invited;
    this.write('target-team', sameTeam ? '✓ Nel team' : invited ? 'Inviato' : '+ Team');
  }

  setLocation(name: string): void { this.write('biome', name); this.write('map-location', name); }

  private toggleSocial(open?: boolean): void {
    const panel = this.ref('social-panel');
    const visible = open ?? panel.hidden;
    panel.hidden = !visible;
    if (visible) this.actions.releaseControls?.();
    this.ref('social-toggle').setAttribute('aria-expanded', String(visible));
    if (visible) this.renderSocial();
  }

  private socialButton(label: string, action: SocialAction, id?: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.socialAction = action;
    if (id) button.dataset.targetId = id;
    if (label === '×') button.setAttribute('aria-label', action === 'team-decline' ? 'Rifiuta invito al team' : 'Rifiuta richiesta di amicizia');
    button.addEventListener('click', () => this.sendSocial(action, id));
    return button;
  }

  private sendSocial(action: SocialAction, id?: string): void {
    if (action === 'team-invite' && id) {
      if ((this.inviteCooldowns.get(id) ?? 0) > Date.now()) return;
      this.inviteCooldowns.set(id, Date.now() + 3000);
      this.updateInviteButtons();
      window.setTimeout(() => { this.inviteCooldowns.delete(id); this.updateInviteButtons(); }, 3000);
    }
    this.actions.social(action, id);
  }

  private updateInviteButtons(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-social-action="team-invite"]')) {
      const pending = (this.inviteCooldowns.get(button.dataset.targetId!) ?? 0) > Date.now();
      button.disabled = pending; button.textContent = pending ? 'Inviato' : '+ Team';
    }
    if (this.selected) this.setSelected(this.selected);
  }

  private renderSocial(): void {
    const state = this.socialState;
    const cache = JSON.stringify(state);
    if (cache === this.socialCache) return;
    this.socialCache = cache;
    const container = this.ref('social-content');
    container.replaceChildren();
    if (!state) {
      container.append(textElement('p', 'social-empty', 'I tuoi compagni appariranno qui quando entri nel mondo.'));
      return;
    }
    const section = (title: string, count: number): HTMLElement => {
      const block = textElement('section', 'social-section', '');
      block.append(textElement('h3', '', `${title} (${count})`));
      container.append(block);
      return block;
    };
    const row = (name: string, detail: string, buttons: HTMLElement[]): HTMLElement => {
      const item = textElement('div', 'social-row', '');
      const labels = textElement('div', 'social-person', '');
      labels.append(textElement('strong', '', name), textElement('small', '', detail));
      const controls = textElement('div', 'social-row-actions', '');
      controls.append(...buttons);
      item.append(labels, controls);
      return item;
    };
    if (state.requests.length || state.teamInvites.length) {
      const requests = section('Inviti in arrivo', state.requests.length + state.teamInvites.length);
      state.requests.forEach(request => requests.append(row(request.name, 'Richiesta di amicizia', [this.socialButton('Accetta', 'friend-accept', request.id), this.socialButton('×', 'friend-decline', request.id)])));
      state.teamInvites.forEach(invite => requests.append(row(invite.name, 'Invito al team', [this.socialButton('Accetta', 'team-accept', invite.id), this.socialButton('Rifiuta', 'team-decline', invite.id)])));
    }
    const team = section('Il tuo team', state.team?.members.length || 0);
    if (state.team) {
      state.team.members.forEach(member => team.append(row(member.name, `${member.online ? 'Online' : 'Offline'}${member.id === state.team!.leaderId ? ' · Caposquadra' : ''}`, [])));
      team.append(this.socialButton('Lascia il team', 'team-leave'));
    } else {
      team.append(textElement('p', 'social-empty', 'Invita un giocatore per partire insieme. I membri del team non possono ferirsi.'));
    }
    const friends = section('Amici', state.friends.length);
    if (!state.friends.length) friends.append(textElement('p', 'social-empty', 'Ogni alleanza comincia con un incontro. Seleziona un giocatore e aggiungilo agli amici.'));
    state.friends.forEach(friend => friends.append(row(friend.name, friend.online ? '● Online' : '○ Offline', [...(friend.online ? [this.socialButton('+ Team', 'team-invite', friend.id)] : []), this.socialButton('Rimuovi', 'friend-remove', friend.id)])));
    const nearby = section('Nelle vicinanze', state.nearby.length);
    if (!state.nearby.length) nearby.append(textElement('p', 'social-empty', 'Nessun altro viaggiatore nei dintorni.'));
    state.nearby.forEach(player => {
      const controls: HTMLElement[] = [];
      if (!player.friend) controls.push(this.socialButton('+ Amico', 'friend-request', player.id));
      if (!player.teamId || player.teamId !== state.team?.id) controls.push(this.socialButton('+ Team', 'team-invite', player.id));
      const item = row(player.name, `${CLASSES[player.classId].name} · LV ${player.level}`, controls);
      item.querySelector('.social-person')!.addEventListener('click', () => this.actions.select(player.id));
      nearby.append(item);
    });
  }

  toast(message: string, tone: 'info' | 'error' | 'success' = 'info'): void {
    if (tone !== 'error') return;
    this.ref('toasts').replaceChildren();
    this.showToast(message, tone);
  }

  private showToast(message: string, tone: 'info' | 'error' | 'success', complete?: () => void): void {
    const toast = textElement('div', `toast toast-${tone}`, message);
    toast.title = message;
    const stack = this.ref('toasts');
    stack.append(toast);
    while (stack.childElementCount > 4) stack.firstElementChild?.remove();
    window.setTimeout(() => {
      toast.classList.add('toast-leaving');
      window.setTimeout(() => { toast.remove(); complete?.(); }, 250);
    }, Math.max(tone === 'error' ? 6500 : 4200, message.length * 45));
  }
}
