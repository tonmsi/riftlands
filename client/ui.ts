import { CLASSES, levelFromXp } from '../shared/config';
import { nearArenaGate } from '../shared/arena';
import { bindingLabel, defaultControls, type ControlSettings } from './controls';
import { ControlOptions } from './control-options';
import { GameDisplay } from './game-display';
import { InteractionUI } from './interaction-ui';
import { PopupManager } from './popups';
import { QuestJournalUI, renderCompletedQuests } from './quest-journal';
import { newNarrativeProgress, type NarrativeProgress } from '../shared/narrative';
import type { InteractionCommand } from '../shared/interactions';
import type { LobbyArt } from './lobby-assets';
import type { AbilitySlot, Actor, ClassId, ClientMessage, PublicAccount, Snapshot, SocialState } from '../shared/types';

export const PROFILE_URLS: Partial<Record<ClassId, string>> = {
  paladin: new URL('../assets/paladinoProfile.png', import.meta.url).href,
  mage: new URL('../assets/mageProfile.png', import.meta.url).href,
  warrior: new URL('../assets/warriorProfile.png', import.meta.url).href,
};

type SocialAction = Extract<ClientMessage, { type: 'social' }>['action'];

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
  readonly interactions: InteractionUI;
  private readonly popups: PopupManager;
  private readonly journal: QuestJournalUI;
  public readonly canvas: HTMLCanvasElement;
  public readonly minimap: HTMLCanvasElement;
  public readonly compactMinimap = document.createElement('canvas');
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
  private menuScreen: 'auth' | 'character' | 'hub' = 'auth';
  private entranceFrame = 0;
  private entranceTimer = 0;
  private entranceStarted = 0;
  private entranceReady = false;
  private assetsLoaded = false;
  private lobbyArt: LobbyArt = { classes: {} };
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
    try {
      const stored = localStorage.getItem('riftlands.selected-class');
      if (stored && Object.hasOwn(CLASSES, stored)) this.currentClass = stored as ClassId;
    } catch { /* Selection remains available without browser storage. */ }
    root.className = 'rift-app is-menu-loading';
    root.innerHTML = `
      <div class="menu-boot" data-ref="menu-boot" role="status"><span class="boot-mark" aria-hidden="true">✦</span><strong>Preparazione dell’accampamento</strong><span data-ref="boot-label">Caricamento delle immagini e del mondo…</span><progress data-ref="boot-progress" max="1" value="0" aria-label="Preparazione risorse"></progress></div>
      <div class="world-entrance" data-ref="world-entrance" role="region" aria-label="Ingresso in partita" hidden><div class="entrance-controls"><progress data-ref="entrance-progress" max="100" value="0" aria-label="Ingresso in partita"></progress><button type="button" data-ref="entrance-cancel">Annulla</button></div></div>
      <div class="world-stage"><canvas class="world-canvas" aria-label="Mondo di gioco multiplayer" tabindex="0"></canvas>
      </div>
      <div class="lobby" data-screen="auth">
        <header class="site-header"><a class="brand" href="/" aria-label="Riftlands, ingresso"><img data-ref="brand-image" alt="Riftlands" hidden><span data-ref="brand-fallback"><span class="brand-symbol">${icon('<path d="m12 1 10 11-10 11L2 12Z"/><path d="m12 5 6 7-6 7-6-7ZM12 1v22"/>')}</span>RIFTLANDS</span></a><div class="header-right"><a href="/dungeon-maker.html">Dungeon maker ↗</a></div><span class="connection-pill" data-ref="lobby-connection" role="status" hidden><i></i><span></span></span></header>
        <nav class="camp-nav" data-ref="camp-nav" aria-label="Accampamento" hidden><button type="button" data-screen-target="character" aria-pressed="true">La tua leggenda</button><button type="button" data-screen-target="stats" aria-pressed="false">Statistiche</button><button type="button" data-screen-target="rankings" aria-pressed="false">Classifiche</button><button type="button" data-screen-target="achievements" aria-pressed="false">Achievement</button><button type="button" data-screen-target="friends" aria-pressed="false">Amici</button></nav>
        <div class="asset-loader" data-ref="asset-loader"><span data-ref="asset-label" role="status">Preparazione delle Terre di Soglia…</span><progress data-ref="asset-progress" max="1" value="0" aria-label="Caricamento asset"></progress></div>
        <div class="camp-content" data-ref="camp-content">
        <main class="lobby-main" data-ref="lobby-main"><section class="entry-panel" aria-label="Menu principale">
          <div class="camp-heading"><div class="intro"><h1 data-ref="menu-title">Accedi al gioco</h1></div>
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
          </div>
          <form data-ref="entry-form" class="entry-form">
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

            <div class="character-selection" data-ref="character-selection" hidden>
            <div class="champion-stage"><div class="champion-glow"></div><div class="champion-portrait" data-ref="champion-portrait"></div><h2 data-ref="champion-name"></h2></div>
            <div class="section-label"><b>Scegli il campione</b><span>Una nuova storia, ogni volta</span></div>
            <div class="class-choices" role="group" aria-label="Campione">${(Object.keys(CLASSES) as ClassId[]).map(id => `<button type="button" class="class-card ${id === 'mage' ? 'selected' : ''}" data-class="${id}" aria-pressed="${id === 'mage'}" style="--class-color:${CLASSES[id].color}"><span class="class-symbol">${portrait(id)}</span><span class="class-name">${CLASSES[id].name}</span><span class="class-role">${id === 'mage' ? 'DISTANZA · CONTROLLO' : id === 'warrior' ? 'MISCHIA · ASSALTO' : id === 'hunter' ? 'DISTANZA · TRAPPOLE' : 'DIFESA · SUPPORTO'}</span><span class="selection-dot"></span></button>`).join('')}</div>
            <button type="button" class="champion-info-toggle" data-ref="champion-info-toggle" aria-expanded="false" aria-controls="champion-info">Statistiche e abilità</button>
            <div id="champion-info" class="class-detail" data-ref="class-detail"></div>
            </div>
            
            <div class="entry-actions"><button type="submit" class="join-button" data-ref="join">
              <span data-ref="join-text">Accedi</span><span class="join-mobile" aria-hidden="true">Play</span><span class="join-arrow">↗</span>
            </button>
            </div>
          </form>

          <div class="lobby-controls"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Muoviti</span><span><kbd>␣</kbd> Attacca</span><span><kbd>Q</kbd><kbd>E</kbd><kbd>R</kbd> Abilità</span><span class="mouse-hint">↖ Tieni il sinistro per mirare</span></div>
        </section></main>
        <section class="lobby-hub" data-ref="lobby-hub" aria-label="Il tuo profilo" hidden>
          <div class="hub-panel" data-hub-panel="friends"><h2>I tuoi amici</h2><div data-ref="lobby-friends">Accedi per vedere i tuoi amici.</div></div>
          <div class="hub-panel" data-hub-panel="rankings" hidden><h2>Classifica esperienza</h2><p>I primi 20 giocatori, ordinati per XP.</p><ol data-ref="lobby-rankings"></ol></div>
          <div class="hub-panel" data-hub-panel="stats" hidden><h2>Le tue statistiche</h2><div data-ref="lobby-stats">Accedi per vedere i tuoi progressi.</div></div>
          <div class="hub-panel" data-hub-panel="achievements" hidden><h2>I tuoi achievement</h2><h3>Missioni completate</h3><div data-ref="completed-quests"><p>Non hai ancora completato missioni.</p></div><h3>Traguardi</h3><span class="coming-soon">In arrivo</span></div>
          <div class="hub-panel" data-hub-panel="settings" hidden><span class="eyebrow">IL TUO STILE DI GIOCO</span><h2>Impostazioni</h2><p>Prepara i comandi prima di partire. Le tue preferenze vengono salvate su questo dispositivo.</p><div class="setting-tile"><div><strong>Tastiera e mouse</strong><p>Movimento, attacchi e abilità. Ogni azione, a modo tuo.</p></div><button type="button" data-ref="configure-controls">Configura tasti ↗</button></div></div>
          <div class="hub-status"><span data-ref="lobby-data-status" role="status"></span><button type="button" data-ref="refresh-lobby">Aggiorna</button></div>
        </section>
        </div>
      </div>
      <div class="game-hud" hidden>
        <section class="player-panel glass"><div class="player-portrait" data-ref="portrait"></div><div class="player-vitals"><div class="player-name-row"><strong data-ref="player-name"></strong><span data-ref="player-level">LV 1</span><span class="player-network"><span data-ref="online" title="Giocatori online">1</span><i class="network-dot" aria-hidden="true"></i><span data-ref="ping">— ms</span></span></div><div class="vital-row"><span>HP</span><div class="meter hp-meter"><i data-ref="hp-fill"></i><span data-ref="hp-label"></span></div></div><div class="vital-row"><span data-ref="resource-name">MP</span><div class="meter resource-meter"><i data-ref="resource-fill"></i><span data-ref="resource-label"></span></div></div><div class="xp-meter"><i data-ref="xp-fill"></i></div></div></section>
        <div class="world-location glass"><span class="location-dot"></span><div><strong data-ref="biome">Terre di Soglia</strong></div><span class="location-decoration">✦</span></div>
        <div class="game-top-right"><div class="status-row"><div class="gold-counter glass" title="Gold raccolti">${icon('<circle cx="12" cy="12" r="8"/><path d="M14.8 8.7a4.5 4.5 0 1 0 0 6.6M9 10h5M9 14h5"/>')}<b data-ref="hud-gold">0</b></div></div><div class="menu-buttons"><button type="button" class="glass hud-menu-button settings-toggle" data-ref="settings-toggle" aria-label="Impostazioni" title="Impostazioni" aria-expanded="false" aria-controls="game-settings">${icon('<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>')}</button><button class="glass hud-menu-button" data-ref="social-toggle" aria-expanded="false">${icon('<circle cx="8" cy="8" r="3"/><path d="M2 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 4 5v2"/>')}<span>Compagni</span><i class="notification-dot" data-ref="social-dot" hidden></i></button></div></div>
        <aside id="game-settings" class="settings-panel glass" data-ref="settings-panel" aria-label="Impostazioni" hidden><div class="settings-actions"><button class="glass hud-menu-button" data-ref="leave" title="Torna al menu" aria-label="Torna al menu">${icon('<path d="M10 3H3v18h7M8 12h14M17 7l5 5-5 5"/>')}<span>Esci</span></button></div></aside><div class="effect-list" data-ref="effects"></div>
        <aside class="team-invite glass" data-ref="team-invite" aria-label="Invito al team" hidden></aside>
        <div class="player-details" data-ref="player-details" role="region" aria-label="Compagni del team" tabindex="0"><section class="team-roster glass" data-ref="team-roster" aria-label="Membri del team" hidden></section></div>
        <section class="target-panel glass" data-ref="target" hidden><div class="target-heading"><span data-ref="target-type">GIOCATORE</span><button data-ref="target-close" aria-label="Deseleziona bersaglio">×</button></div><strong data-ref="target-name"></strong><small data-ref="target-detail"></small><div class="meter hp-meter target-health"><i data-ref="target-fill"></i></div><div class="target-actions" data-ref="target-actions"><button data-ref="target-friend">+ Amico</button><button data-ref="target-team">+ Team</button></div></section>
        <aside class="social-panel glass" data-ref="social-panel" hidden><div class="social-header"><h2>Compagni</h2><button data-ref="social-close" aria-label="Chiudi compagni">×</button></div><div class="social-content" data-ref="social-content"></div></aside>
        <div class="map-dismiss" data-ref="map-dismiss" hidden aria-hidden="true"></div>
        <div class="minimap-panel glass"><button type="button" class="map-close" data-ref="map-close" aria-label="Chiudi mappa">×</button><header class="map-heading"><strong data-ref="map-location">Terre di Soglia</strong></header><canvas class="minimap" width="260" height="260" aria-label="Mappa estesa"></canvas><div><span>MAPPA ESTESA</span><span>N ↑</span></div></div>
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
    this.popups = new PopupManager(root);
    this.interactions = new InteractionUI(root, command => this.actions.interact?.(command), message => this.toast(message), () => this.canvas.focus({ preventScroll: true }), this.popups);
    this.journal = new QuestJournalUI(root.querySelector('.game-hud')!, root.querySelector('.player-panel')!, this.popups);
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
    this.mapVisible = false;
    const mapPanel = root.querySelector<HTMLElement>('.minimap-panel')!; mapPanel.id = 'game-minimap';
    const mapActions = document.createElement('div');
    mapActions.className = 'map-actions';
    mapActions.append(root.querySelector('.fullscreen-toggle')!, this.ref('leave'));
    mapPanel.append(mapActions);
    root.querySelector('.player-panel')!.append(this.ref('effects'));
    this.ref('effects').classList.add('character-effects');
    const targetEffects = document.createElement('div');
    targetEffects.className = 'effect-list character-effects';
    targetEffects.dataset.ref = 'target-effects';
    this.refs.set('target-effects', targetEffects);
    this.ref('target').append(targetEffects);
    const hud = root.querySelector<HTMLElement>('.game-hud')!;
    const hudTouches = new Map<number, HTMLButtonElement>();
    // A second finger does not receive a browser compatibility click while the
    // joystick owns the first finger. Activate HUD buttons from their pointer.
    hud.addEventListener('pointerdown', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (event.pointerType !== 'touch' || !button || button.closest('.ability-bar') || button.disabled) return;
      event.preventDefault();
      hudTouches.set(event.pointerId, button);
      button.setPointerCapture(event.pointerId);
    });
    hud.addEventListener('pointerup', event => {
      const button = hudTouches.get(event.pointerId);
      hudTouches.delete(event.pointerId);
      if (!button) return;
      const bounds = button.getBoundingClientRect();
      if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) button.click();
    });
    for (const name of ['pointercancel', 'lostpointercapture']) hud.addEventListener(name, event => hudTouches.delete((event as PointerEvent).pointerId));
    hud.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest('button');
      if ((event as PointerEvent).pointerType === 'touch' && button && !button.closest('.ability-bar')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    // Pointer clicks on HUD buttons must not leave keyboard gameplay on a button.
    hud.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('button') && this.isPlaying && !this.exitDialog.open) this.canvas.focus({ preventScroll: true });
    });
    this.mapToggle.type = 'button'; this.mapToggle.className = 'compact-map map-toggle';
    const location = root.querySelector('.world-location')!;
    this.compactMinimap.className = 'compact-minimap';
    this.compactMinimap.setAttribute('aria-hidden', 'true');
    this.mapToggle.append(this.compactMinimap);
    location.remove();
    root.querySelector('.game-hud')!.append(this.mapToggle);
    this.mapToggle.setAttribute('aria-controls', mapPanel.id);
    this.mapToggle.addEventListener('click', () => {
      this.setMapVisible(!this.mapVisible);
    });
    this.ref('map-dismiss').addEventListener('pointerdown', event => {
      if (!this.mapVisible) return;
      event.preventDefault(); event.stopPropagation();
      this.setMapVisible(false);
    });
    this.ref('map-close').addEventListener('click', () => { this.setMapVisible(false); this.canvas.focus({ preventScroll: true }); });
    this.updateMap();
    this.ref('leave').setAttribute('aria-label', 'Torna al menu');
    this.ref('social-toggle').setAttribute('aria-label', 'Compagni');
    this.options = new ControlOptions(root, () => !this.isPlaying && this.status !== 'connecting' && this.status !== 'reconnecting', settings => {
      this.setControls(settings); this.actions.controlsChanged?.(settings);
    });
    this.popups.register(this.options.dialog, () => this.options.dialog.open, () => this.options.close());
    this.popups.register(this.exitDialog, () => this.exitDialog.open, () => { this.exitDialog.close(); this.display.resume(); });
    this.popups.register(mapPanel, () => this.mapVisible, () => this.setMapVisible(false), this.mapToggle);
    this.popups.register(this.ref('social-panel'), () => !this.ref('social-panel').hidden, () => this.toggleSocial(false), this.ref('social-toggle'));
    this.popups.register(this.ref('settings-panel'), () => !this.ref('settings-panel').hidden, () => this.toggleSettings(false), this.ref('settings-toggle'));
    this.popups.register(this.ref('team-invite'), () => !this.ref('team-invite').hidden, () => { this.ref('team-invite').hidden = true; });
    const optionsButton = document.createElement('button'); optionsButton.type = 'button';
    optionsButton.className = 'options-button'; optionsButton.textContent = 'Impostazioni'; optionsButton.hidden = true;
    optionsButton.addEventListener('click', () => this.showHub('settings'));
    root.querySelector('.header-right')!.prepend(optionsButton);

    root.querySelectorAll<HTMLButtonElement>('[data-screen-target]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.screenTarget === 'character') { this.menuScreen = 'character'; this.renderMenu(); }
      else this.showHub(button.dataset.screenTarget!);
    }));
    this.ref('configure-controls').addEventListener('click', () => this.options.open(this.controls));
    this.ref('champion-info-toggle').addEventListener('click', () => {
      const open = this.ref('class-detail').classList.toggle('is-mobile-open');
      this.ref('champion-info-toggle').setAttribute('aria-expanded', String(open));
      this.ref('champion-info-toggle').textContent = open ? 'Chiudi statistiche' : 'Statistiche e abilità';
    });
    this.ref('entrance-cancel').addEventListener('click', () => this.actions.leave());
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
        if (!this.assetsLoaded) return;
        if (this.display.touch) void this.display.enterFullscreen();
        this.startWorldEntrance();
        this.actions.joinSaved(this.currentClass);
        return;
      }

      const name = this.nameInput.value.trim();
      const password = this.passwordInput.value;
      if (!name || !password) {
        this.toast('Compila nome e password per procedere.', 'error');
        return;
      }
      this.actions.joinCredentials(this.authMode, name, password, this.currentClass);
    });

    root.querySelectorAll<HTMLButtonElement>('[data-class]').forEach(button => button.addEventListener('click', () => {
      this.currentClass = button.dataset.class as ClassId;
      try { localStorage.setItem('riftlands.selected-class', this.currentClass); } catch { /* Optional preference. */ }
      this.renderClass();
      this.actions.previewClass?.(this.currentClass);
    }));

    this.ref('leave').addEventListener('click', () => this.confirmLeave());
    this.ref('settings-toggle').addEventListener('click', () => this.toggleSettings());
    this.ref('social-toggle').addEventListener('click', () => this.toggleSocial());
    this.ref('social-close').addEventListener('click', () => this.toggleSocial(false));
    const targetSummary = document.createElement('button');
    targetSummary.type = 'button';
    targetSummary.className = 'target-summary';
    targetSummary.setAttribute('aria-expanded', 'false');
    targetSummary.innerHTML = '<span class="target-portrait player-portrait"></span><span class="target-vitals"><span class="target-name-row"><strong></strong><small class="target-level"></small></span><span class="target-summary-meter target-summary-hp"><i></i><span></span></span><span class="target-summary-meter target-summary-resource"><i></i><span></span></span></span>';
    this.ref('target').prepend(targetSummary);
    targetSummary.addEventListener('click', () => {
      const expanded = this.ref('target').classList.toggle('is-expanded');
      targetSummary.setAttribute('aria-expanded', String(expanded));
    });
    this.popups.register(this.ref('target'), () => this.ref('target').classList.contains('is-expanded'), () => {
      this.ref('target').classList.remove('is-expanded'); targetSummary.setAttribute('aria-expanded', 'false');
    }, targetSummary);
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
  get inputBlocked(): boolean { return !this.ref('world-entrance').hidden || this.exitDialog.open; }
  private toggleSettings(open = this.ref('settings-panel').hidden): void {
    this.ref('settings-panel').hidden = !open;
    this.ref('settings-toggle').setAttribute('aria-expanded', String(open));
    if (open) { this.toggleSocial(false); this.setMapVisible(false); }
  }
  private setMapVisible(visible: boolean): void {
    this.mapVisible = visible;
    if (visible) { this.toggleSettings(false); this.toggleSocial(false); }
    this.updateMap();
  }
  private updateMap(): void {
    this.root.classList.toggle('map-open', this.mapVisible);
    this.root.querySelector<HTMLElement>('.minimap-panel')!.hidden = !this.mapVisible;
    this.mapToggle.setAttribute('aria-expanded', String(this.mapVisible));
    this.mapToggle.setAttribute('aria-label', this.mapVisible ? 'Nascondi mappa' : 'Mostra mappa');
    this.mapToggle.title = this.mapVisible ? 'Nascondi mappa' : 'Mostra mappa';
    this.ref('map-dismiss').hidden = true;
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
    this.write('join-text', isLogin ? 'Accedi' : 'Crea account');
    this.passwordInput.autocomplete = isLogin ? 'current-password' : 'new-password';
    this.renderMenu();
  }

  setSavedAccount(account: PublicAccount | null): void {
    const changed = this.savedAccount?.id !== account?.id;
    if (changed || !account) { this.journal.reset(); renderCompletedQuests(this.ref('completed-quests'), newNarrativeProgress()); }
    this.savedAccount = account;
    this.renderLobbyStats();
    if (changed) void this.refreshLobby();
    const hasSaved = Boolean(account);
    if (changed || !hasSaved) this.menuScreen = hasSaved ? 'character' : 'auth';
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
      this.write('join-text', this.authMode === 'login' ? 'Accedi' : 'Crea account');
      this.nameInput.setAttribute('required', 'true');
      this.passwordInput.setAttribute('required', 'true');
      this.passwordInput.value = '';
    }
    this.renderMenu();
  }

  private showHub(section: string): void {
    if (!this.savedAccount) return;
    this.menuScreen = 'hub';
    this.root.querySelectorAll<HTMLElement>('[data-hub-panel]').forEach(panel => { panel.hidden = panel.dataset.hubPanel !== section; });
    this.root.querySelectorAll<HTMLButtonElement>('[data-screen-target]').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.screenTarget === section)));
    this.renderMenu();
    this.ref('camp-content').scrollTop = 0;
    void this.refreshLobby();
  }

  private renderMenu(): void {
    const lobby = this.root.querySelector<HTMLElement>('.lobby')!;
    const changedScreen = lobby.dataset.screen !== this.menuScreen;
    lobby.dataset.screen = this.menuScreen;
    this.root.querySelector<HTMLElement>('.entry-panel')!.hidden = this.menuScreen === 'hub';
    this.ref('camp-nav').hidden = !this.savedAccount;
    this.root.querySelector<HTMLButtonElement>('.options-button')!.hidden = !this.savedAccount;
    this.ref('lobby-hub').hidden = this.menuScreen !== 'hub';
    this.ref('lobby-main').hidden = this.menuScreen === 'hub';
    this.ref('character-selection').hidden = this.menuScreen !== 'character';
    this.ref('saved-card').hidden = !this.savedAccount;
    const auth = this.menuScreen === 'auth';
    if (auth) this.write('join-text', this.authMode === 'login' ? 'Accedi' : 'Crea account');
    this.write('menu-title', this.authMode === 'login' ? 'Accedi al gioco' : 'Crea il tuo account');
    this.root.querySelector<HTMLElement>('.intro')!.hidden = !auth;
    if (!auth) this.write('join-text', 'Continua con ' + CLASSES[this.currentClass].name);
    this.ref('join').setAttribute('aria-label', auth ? (this.authMode === 'login' ? 'Accedi' : 'Crea account') : 'Play con ' + CLASSES[this.currentClass].name);
    if (this.menuScreen !== 'hub') this.root.querySelectorAll<HTMLButtonElement>('[data-screen-target]').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.screenTarget === 'character')));
    this.updateMenuBackground();
    this.updateJoinAvailability();
    if (changedScreen) this.ref('camp-content').scrollTop = 0;
  }

  private updateMenuBackground(): void {
    const image = this.menuScreen === 'auth' ? this.lobbyArt.loginBackground
      : this.menuScreen === 'character' ? this.lobbyArt.selectionBackground
      : this.lobbyArt.classes[this.currentClass]?.background;
    this.root.querySelector<HTMLElement>('.lobby')!.style.setProperty('--menu-art', image ? `url(${JSON.stringify(image)})` : 'none');
  }

  async setLobbyArt(art: LobbyArt): Promise<void> {
    this.lobbyArt = art;
    if (art.logo) { (this.ref('brand-image') as HTMLImageElement).src = art.logo; this.ref('brand-image').hidden = false; this.ref('brand-fallback').hidden = true; }
    this.renderClass();
    this.updateMenuBackground();
    await Promise.all(Array.from(this.root.querySelectorAll<HTMLImageElement>('.lobby img'), image => image.decode().catch(() => {})));
    this.ref('menu-boot').hidden = true;
    this.root.classList.remove('is-menu-loading');
  }

  setAssetProgress(done: number, total: number, failed: number): void {
    const progress = this.ref('asset-progress') as HTMLProgressElement;
    progress.max = total; progress.value = done;
    const bootProgress = this.ref('boot-progress') as HTMLProgressElement;
    bootProgress.max = total; bootProgress.value = done;
    this.write('boot-label', done === total ? 'Ultimi preparativi…' : `Caricamento risorse · ${done}/${total}`);
    this.assetsLoaded = done === total;
    this.write('asset-label', this.assetsLoaded ? (failed ? 'Alcune immagini non disponibili' : '') : `Caricamento risorse · ${done}/${total}`);
    this.ref('asset-loader').classList.toggle('is-ready', this.assetsLoaded);
    this.ref('asset-loader').hidden = this.assetsLoaded && !failed;
    this.renderMenu();
  }

  private updateJoinAvailability(): void {
    (this.ref('join') as HTMLButtonElement).disabled = this.status === 'connecting' || this.status === 'reconnecting' || !this.ref('world-entrance').hidden || (Boolean(this.savedAccount) && !this.assetsLoaded);
  }

  private startWorldEntrance(): void {
    this.cancelWorldEntrance();
    const overlay = this.ref('world-entrance');
    const art = this.lobbyArt.classes[this.currentClass]?.background ?? this.lobbyArt.selectionBackground ?? this.lobbyArt.loginBackground;
    overlay.style.backgroundImage = art ? `url(${JSON.stringify(art)})` : 'none';
    overlay.hidden = false;
    overlay.classList.remove('is-leaving');
    this.root.classList.add('is-entering');
    this.entranceReady = false;
    this.entranceStarted = performance.now();
    this.options.close();
    this.actions.releaseControls?.();
    const progress = this.ref('entrance-progress') as HTMLProgressElement;
    progress.value = 0;
    const advance = () => {
      const elapsed = performance.now() - this.entranceStarted;
      progress.value = Math.min(92, elapsed / 2000 * 92);
      if (elapsed >= 2000 && this.entranceReady) {
        progress.value = 100;
        this.entranceFrame = 0;
        overlay.classList.add('is-leaving');
        this.root.classList.remove('is-entering');
        this.entranceTimer = window.setTimeout(() => {
          overlay.hidden = true;
          this.entranceTimer = 0;
          this.updateJoinAvailability();
          if (this.isPlaying) this.canvas.focus({ preventScroll: true });
        }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400);
      } else this.entranceFrame = requestAnimationFrame(advance);
    };
    this.entranceFrame = requestAnimationFrame(advance);
    this.updateJoinAvailability();
  }

  private cancelWorldEntrance(): void {
    cancelAnimationFrame(this.entranceFrame);
    clearTimeout(this.entranceTimer);
    this.entranceFrame = 0;
    this.entranceTimer = 0;
    this.entranceReady = false;
    this.ref('world-entrance').hidden = true;
    this.root.classList.remove('is-entering');
    this.updateJoinAvailability();
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
    token = this.actions.lobbyToken?.() ?? null;
    if (!token) try { token = localStorage.getItem('riftlands.jwt'); } catch { /* Guest menu remains available. */ }
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
      const data = await response.json() as { account: PublicAccount | null; narrative?: NarrativeProgress; friends: SocialState['friends']; leaderboard: Pick<PublicAccount, 'id' | 'name' | 'xp' | 'kills'>[] };
      if (request !== this.lobbyRequest) return;
      if (data.account || this.savedAccount) this.setSavedAccount(data.account);
      if (!this.isPlaying) {
        const narrative = data.account ? data.narrative ?? newNarrativeProgress() : newNarrativeProgress();
        this.journal.update(narrative); renderCompletedQuests(this.ref('completed-quests'), narrative);
      }
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
    this.ref('champion-portrait').innerHTML = portrait(this.currentClass);
    const customPortrait = this.lobbyArt.classes[this.currentClass]?.portrait;
    if (customPortrait) { const image = document.createElement('img'); image.src = customPortrait; image.alt = ''; this.ref('champion-portrait').replaceChildren(image); }
    this.write('champion-name', chosen.name);
    this.updateMenuBackground();
    if (this.menuScreen === 'character') {
      this.write('join-text', 'Continua con ' + chosen.name);
      this.ref('join').setAttribute('aria-label', 'Play con ' + chosen.name);
    }
    this.root.querySelectorAll<HTMLButtonElement>('[data-class]').forEach(button => {
      const active = button.dataset.class === this.currentClass;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const basic = chosen.abilities.basic;
    const number = (value: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(value);
    const stats = [
      ['Salute', number(chosen.maxHp), 'PV'],
      [chosen.resource === 'rage' ? 'Rabbia' : 'Mana', number(chosen.maxResource), 'punti'],
      ['Movimento', number(chosen.speed), 'unità/s'],
      ['Vel. attacco', number(1 / basic.cooldown), 'attacchi/s'],
      ['Danno base', number(basic.damage), 'per colpo'],
      ['Armatura', number(chosen.armor * 100), '% riduzione'],
      ['Portata', number(basic.range), 'unità'],
      ['Intervallo', number(basic.cooldown), 's tra attacchi'],
    ];
    this.ref('class-detail').innerHTML = `<div class="class-detail-heading"><span class="eyebrow">PROFILO DEL CAMPIONE</span><h3>${chosen.subtitle}</h3></div><p>${chosen.description}</p><dl class="champion-stats" aria-label="Statistiche base di ${chosen.name}">${stats.map(([label, value, unit]) => `<div><dt>${label}</dt><dd>${value}<small>${unit}</small></dd></div>`).join('')}</dl><p class="gem-note">Statistiche base · potenziamenti con gemme in arrivo</p><div class="lobby-abilities">${SLOTS.map(slot => {
      const ability = chosen.abilities[slot];
      return `<div class="lobby-ability" title="${ability.description}"><kbd>${this.keyLabel(slot)}</kbd><span><strong>${ability.name}</strong><small>Ricarica ${number(ability.cooldown)} s${ability.cost ? ` · ${ability.cost} ${chosen.resource === 'rage' ? 'rabbia' : 'mana'}` : ' · nessun costo'}</small></span></div>`;
    }).join('')}</div>`;
  }

  setConnection(status: 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline', detail?: string): void {
    this.status = status;
    if (status === 'connecting' || status === 'reconnecting') this.options.close();
    const optionsButton = this.root.querySelector<HTMLButtonElement>('.options-button');
    if (optionsButton) optionsButton.disabled = this.isPlaying || status === 'connecting' || status === 'reconnecting';
    const labels = { idle: '', connecting: 'Connessione in corso', online: '', reconnecting: 'Riconnessione…', offline: 'Connessione interrotta' };
    const pill = this.ref('lobby-connection');
    pill.dataset.status = status;
    pill.querySelector('span')!.textContent = detail || labels[status];
    pill.hidden = status === 'idle' || status === 'online';
    if (status === 'offline') this.cancelWorldEntrance();
    if (status === 'reconnecting') this.entranceReady = false;
    this.updateJoinAvailability();
    const banner = this.ref('connection-banner');
    banner.hidden = !this.isPlaying || (status !== 'offline' && status !== 'reconnecting');
    banner.textContent = status === 'reconnecting'
      ? `Riconnessione al mondo…${detail ? ` ${detail}` : ''}`
      : detail || 'Connessione interrotta. Torna al menu per riprovare.';
  }

  setPlaying(playing: boolean): void {
    if (!playing) this.popups.dismiss();
    if (!playing) this.cancelWorldEntrance();
    if (!playing) this.setMapVisible(false);
    this.isPlaying = playing;
    this.toggleSettings(false);
    this.display.setPlaying(playing);
    if (!playing) this.exitDialog.close();
    if (playing) this.options.close();
    this.root.querySelector<HTMLButtonElement>('.options-button')!.disabled = playing || this.status === 'connecting' || this.status === 'reconnecting';
    this.root.classList.toggle('is-playing', playing);
    (this.root.querySelector('.lobby') as HTMLElement).hidden = playing;
    (this.root.querySelector('.game-hud') as HTMLElement).hidden = !playing;
    this.interactions.setVisible(playing);
    this.ref('connection-banner').hidden = true;
    if (playing) {
      if (this.ref('world-entrance').hidden) this.canvas.focus({ preventScroll: true });
    } else {
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
    this.interactions.update(snapshot);
    this.journal.update(snapshot.narrative, snapshot.inventory);
    if (!this.ref('world-entrance').hidden) this.entranceReady = true;
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
    let arenaText = nearArenaGate(player) ? 'Arena 1v1 · Entra nella zona per partecipare' : '';
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

    this.renderEffects(this.ref('effects'), player, snapshot.time);
    if (this.selected) this.setSelected(snapshot.actors.find(actor => actor.id === this.selected!.id) || null);
    this.renderTeamRoster();
    this.updateInviteButtons();
  }

  private renderEffects(container: HTMLElement, actor: Actor, time: number): void {
    const effectNames = { haste: 'Passo celere', power: 'Potere antico', weakness: 'Maledizione', slow: 'Rallentato', shield: 'Scudo attivo', root: 'Immobilizzato' };
    const effects = actor.effects.filter(effect => effect.until > time).map(effect => `${effectNames[effect.kind]} · ${Math.ceil((effect.until - time) / 1000)}s`);
    if (actor.hidden) effects.unshift('Nascosto nel cespuglio');
    if (actor.spawnProtectedUntil > time) effects.unshift('Protezione della Soglia');
    const effectText = effects.join('|');
    if (container.dataset.value !== effectText) {
      container.dataset.value = effectText;
      container.replaceChildren(...effects.map(effect => {
        const chip = textElement('span', 'effect-chip', effect);
        chip.title = effect;
        return chip;
      }));
    }
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
    const key = JSON.stringify(invites);
    if (key === this.inviteKey) return;
    this.inviteKey = key;
    panel.hidden = !invite;
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
        const memberPortrait = textElement('span', 'team-portrait player-portrait', '');
        memberPortrait.innerHTML = '<svg class="team-health-ring" viewBox="0 0 44 44" aria-hidden="true"><circle class="team-ring-track" cx="22" cy="22" r="17"/><circle class="team-ring-base" cx="22" cy="22" r="17"/><circle class="team-ring-fill" cx="22" cy="22" r="17" pathLength="100"/></svg><span class="team-portrait-art"></span>';
        const resource = textElement('span', 'team-member-resource team-member-meter', '');
        resource.setAttribute('role', 'meter'); resource.setAttribute('aria-label', `Risorsa di ${member.name}`);
        resource.setAttribute('aria-valuemin', '0'); resource.append(document.createElement('i'));
        row.append(label, memberPortrait, meter, resource); roster.append(row);
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
      const memberPortrait = row.querySelector<HTMLElement>('.team-portrait')!;
      const portraitKey = actor?.classId ?? 'unavailable';
      if (memberPortrait.dataset.portrait !== portraitKey) {
        memberPortrait.dataset.portrait = portraitKey;
        memberPortrait.querySelector('.team-portrait-art')!.innerHTML = actor ? portrait(actor.classId) : icon('<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>');
      }
      const hpPercent = available ? Math.max(0, Math.min(100, hp! / maxHp! * 100)) : 0;
      memberPortrait.querySelector<SVGCircleElement>('.team-ring-fill')!.style.strokeDasharray = `${hpPercent} 100`;
      row.setAttribute('aria-label', `${member.name}: ${!member.online ? 'offline' : available ? `${Math.ceil(hp!)} di ${Math.ceil(maxHp!)} punti vita` : 'in altra area'}`);
      const resource = row.querySelector<HTMLElement>('.team-member-resource')!;
      resource.hidden = !actor || actor.maxResource <= 0;
      if (actor && actor.maxResource > 0) {
        resource.setAttribute('aria-valuemax', String(actor.maxResource));
        resource.setAttribute('aria-valuenow', String(Math.max(0, actor.resource)));
        resource.querySelector('i')!.style.width = `${Math.max(0, Math.min(100, actor.resource / actor.maxResource * 100))}%`;
        resource.querySelector<HTMLElement>('i')!.style.background = CLASSES[actor.classId].resource === 'rage' ? '#dc9c7c' : '#ae9ee9';
      }
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
    this.renderEffects(this.ref('target-effects'), actor, this.latest?.time ?? Date.now());
    summary.querySelector('strong')!.textContent = actor.name;
    summary.querySelector('.target-level')!.textContent = `LV ${actor.level}`;
    const targetPortrait = summary.querySelector<HTMLElement>('.target-portrait')!;
    const portraitKey = actor.kind === 'npc' ? `npc:${actor.npcKind}` : actor.classId;
    if (targetPortrait.dataset.portrait !== portraitKey) {
      targetPortrait.dataset.portrait = portraitKey;
      targetPortrait.innerHTML = actor.kind === 'npc' ? icon('<path d="m4 5 4 2 4-4 4 4 4-2-2 13-6 3-6-3Z"/><path d="m7 11 3 1M17 11l-3 1M9 16h6"/>') : portrait(actor.classId);
    }
    targetPortrait.style.color = actor.kind === 'npc' ? '#ffbb9b' : CLASSES[actor.classId].color;
    const resourceName = CLASSES[actor.classId].resource === 'rage' ? 'Rage' : 'Mana';
    const updateSummaryMeter = (selector: string, value: number, max: number, label: string) => {
      const meter = summary.querySelector<HTMLElement>(selector)!;
      meter.querySelector('span')!.textContent = `${label} ${Math.ceil(value)} / ${max}`;
      meter.querySelector('i')!.style.width = `${max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0}%`;
    };
    updateSummaryMeter('.target-summary-hp', actor.hp, actor.maxHp, 'PV');
    updateSummaryMeter('.target-summary-resource', actor.resource, actor.maxResource, resourceName);
    summary.querySelector<HTMLElement>('.target-summary-resource')!.hidden = actor.maxResource <= 0;
    summary.style.setProperty('--target-resource-color', CLASSES[actor.classId].resource === 'rage' ? '#df9877' : '#aaa0e8');
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
    if (visible) { this.toggleSettings(false); this.setMapVisible(false); }
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
