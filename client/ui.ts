import { CLASSES, levelFromXp } from '../shared/config';
import { ARENA_GATE } from '../shared/arena';
import type { AbilitySlot, Actor, ClassId, ClientMessage, PublicAccount, Snapshot, SocialState } from '../shared/types';

const PROFILE_URLS: Partial<Record<ClassId, string>> = {
  paladin: '../assets/paladinoProfile.png',
  mage: '../assets/mageProfile.png',
  warrior: '../assets/warriorProfile.png',
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
}

const SLOTS: AbilitySlot[] = ['basic', 'q', 'e', 'r'];
const KEYS = { basic: '␣', q: 'Q', e: 'E', r: 'R' };
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
  private lastSanctuary: Snapshot['sanctuary'];
  private readonly goldWallet: HTMLElement;
  private previousGold?: number;

  constructor(private root: HTMLElement, private actions: UIActions) {
    root.className = 'rift-app';
    root.innerHTML = `
      <div class="world-stage"><canvas class="world-canvas" aria-label="Mondo di gioco multiplayer" tabindex="0"></canvas>
        <div class="preview-top"><span class="live-label"><i></i> APERTO ALL’ESPLORAZIONE</span><span class="preview-seed">SEED / 734291</span></div>
        <div class="preview-compass" aria-hidden="true"><span>N</span><div>✦</div></div>
        <div class="preview-caption"><div class="preview-caption-mark">I</div><div><span class="eyebrow">IL TUO PROSSIMO ORIZZONTE</span><h2>Le Terre di Soglia</h2><p>Un mondo che continua, anche oltre la mappa.</p></div></div>
        <div class="preview-tag"><i></i><span>MONDO PROCEDURALE</span><span class="infinity-symbol">∞</span></div>
      </div>
      <div class="lobby">
        <header class="site-header"><a class="brand" href="/" aria-label="Riftlands, ingresso"><span class="brand-symbol">${icon('<path d="m12 1 10 11-10 11L2 12Z"/><path d="m12 5 6 7-6 7-6-7ZM12 1v22"/>')}</span>RIFTLANDS<span class="brand-divider"></span><span class="brand-caption">A SHARED FRONTIER</span></a><div class="header-right"><span class="connection-pill" data-ref="lobby-connection"><i></i><span>Pronto a esplorare</span></span><span class="alpha-badge">ALPHA 0.2</span></div></header>
        <main class="lobby-main"><section class="entry-panel" aria-label="Crea il tuo viaggiatore">
          <div class="intro"><div class="eyebrow"><span class="eyebrow-line"></span>UN MONDO INFINITO. LA TUA STORIA.</div><h1>Oltre il confine<span>.</span></h1><p>Trova la tua strada. Stringi alleanze.<br>Lascia il segno in un mondo senza fine.</p></div>
          
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
                <button type="button" class="auth-tab" data-ref="tab-register" role="tab" aria-selected="false">Crea Personaggio</button>
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

            <div class="section-label"><span>01 <b>SCEGLI LA TUA CLASSE</b></span><span>Tre modi di lasciare il segno</span></div>
            <div class="class-choices" role="group" aria-label="Classe del personaggio">${(Object.keys(CLASSES) as ClassId[]).map(id => `<button type="button" class="class-card ${id === 'mage' ? 'selected' : ''}" data-class="${id}" aria-pressed="${id === 'mage'}" style="--class-color:${CLASSES[id].color}"><span class="class-symbol">${icon(CLASS_ICONS[id])}</span><span class="class-name">${CLASSES[id].name}</span><span class="class-role">${id === 'mage' ? 'DISTANZA · CONTROLLO' : id === 'warrior' ? 'MISCHIA · ASSALTO' : 'DIFESA · SUPPORTO'}</span><span class="selection-dot"></span></button>`).join('')}</div>
            <div class="class-detail" data-ref="class-detail"></div>
            
            <button type="submit" class="join-button" data-ref="join">
              <span data-ref="join-text">Entra nel mondo</span><span class="join-arrow">↗</span>
            </button>
            <div class="entry-note"><span class="save-dot"></span>I tuoi progressi sono protetti dal tuo account personale.</div>
          </form>

          <div class="lobby-controls"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Muoviti</span><span><kbd>␣</kbd> Attacca</span><span><kbd>Q</kbd><kbd>E</kbd><kbd>R</kbd> Abilità</span><span class="mouse-hint">↖ Mouse per mirare</span></div>
        </section></main>
        <footer class="lobby-footer"><div><span class="feature-icon">∞</span><span><b>Nessun confine</b><small>Biomi e incontri generati lungo il cammino</small></span></div><div><span class="feature-icon">${icon('<circle cx="8" cy="8" r="3"/><path d="M2 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 4 5v2"/>')}</span><span><b>La forza di un’alleanza</b><small>Incontra giocatori, aggiungi amici, crea un team</small></span></div><div><span class="feature-icon">${icon('<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>')}</span><span><b>Ogni scelta conta</b><small>Combatti, esplora e padroneggia la tua classe</small></span></div><span class="footer-version">PROTOTIPO GIOCABILE<br>AUTENTICAZIONE SICURA</span></footer>
      </div>
      <div class="game-hud" hidden>
        <section class="player-panel glass"><div class="player-portrait" data-ref="portrait"></div><div class="player-vitals"><div class="player-name-row"><strong data-ref="player-name"></strong><span data-ref="player-level">LV 1</span></div><div class="vital-row"><span>HP</span><div class="meter hp-meter"><i data-ref="hp-fill"></i><span data-ref="hp-label"></span></div></div><div class="vital-row"><span data-ref="resource-name">MP</span><div class="meter resource-meter"><i data-ref="resource-fill"></i><span data-ref="resource-label"></span></div></div><div class="xp-meter"><i data-ref="xp-fill"></i></div></div></section>
        <div class="world-location glass"><span class="location-dot"></span><div><strong data-ref="biome">Terre di Soglia</strong><span data-ref="coords">0 · 0</span></div><span class="location-decoration">✦</span></div>
        <div class="game-top-right"><div class="status-row"><div class="gold-counter glass" title="Gold raccolti">${icon('<circle cx="12" cy="12" r="8"/><path d="M14.8 8.7a4.5 4.5 0 1 0 0 6.6M9 10h5M9 14h5"/>')}<b data-ref="hud-gold">0</b></div><div class="server-status glass"><span class="save-dot"></span><b data-ref="online">1</b> online<span class="status-separator"></span><span data-ref="ping">— ms</span></div></div><div class="menu-buttons"><button class="glass hud-menu-button" data-ref="social-toggle" aria-expanded="false">${icon('<circle cx="8" cy="8" r="3"/><path d="M2 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 4 5v2"/>')}<span>Compagni</span><i class="notification-dot" data-ref="social-dot" hidden></i></button><button class="glass hud-menu-button" data-ref="leave" title="Torna al menu">${icon('<path d="M10 3H3v18h7M8 12h14M17 7l5 5-5 5"/>')}<span>Esci</span></button></div></div>
        <div class="effect-list" data-ref="effects"></div>
        <section class="target-panel glass" data-ref="target" hidden><div class="target-heading"><span data-ref="target-type">GIOCATORE</span><button data-ref="target-close" aria-label="Deseleziona bersaglio">×</button></div><strong data-ref="target-name"></strong><small data-ref="target-detail"></small><div class="meter hp-meter target-health"><i data-ref="target-fill"></i></div><div class="target-actions" data-ref="target-actions"><button data-ref="target-friend">+ Amico</button><button data-ref="target-team">+ Team</button></div></section>
        <aside class="social-panel glass" data-ref="social-panel" hidden><div class="social-header"><div><span class="eyebrow">NON VIAGGIARE DA SOLO</span><h2>I tuoi compagni</h2></div><button data-ref="social-close" aria-label="Chiudi compagni">×</button></div><div class="social-content" data-ref="social-content"></div></aside>
        <div class="minimap-panel glass"><canvas class="minimap" width="168" height="168" aria-label="Mappa locale"></canvas><div><span>LE TERRE DI SOGLIA</span><span>N ↑</span></div></div>
        <div class="combat-hud"><div class="combat-instruction"><span>WASD / FRECCE <b>muovi</b></span><span>MOUSE <b>mira</b></span><span>CLIC <b>seleziona</b></span></div><div class="ability-bar glass" data-ref="ability-bar"></div><div class="combat-caption"><span data-ref="combat-class"></span><span>·</span><span>SPAZIO / CLIC DESTRO per attaccare</span></div></div>
        <div class="world-tip glass"><span>✧</span><span>I cespugli ti nascondono.<br><b>Attaccare rivela la tua posizione.</b></span></div>
        <div class="connection-banner" data-ref="connection-banner" hidden>Riconnessione al mondo…</div>
        <div class="death-overlay" data-ref="death" hidden><span class="eyebrow">IL VIAGGIO NON FINISCE QUI</span><h2>La Soglia ti richiama.</h2><p>Ritorno al punto di partenza tra <b data-ref="death-count">5</b> secondi</p></div>
      </div>
      <div class="toast-stack" data-ref="toasts" aria-live="polite" aria-atomic="false"></div>`;

    root.querySelectorAll<HTMLElement>('[data-ref]').forEach(element => this.refs.set(element.dataset.ref!, element));
    this.arenaStatus.className = 'arena-status';
    this.arenaStatus.setAttribute('role', 'status');
    root.append(this.arenaStatus);
    this.goldWallet = this.ref('hud-gold');
    this.canvas = root.querySelector<HTMLCanvasElement>('.world-canvas')!;
    this.minimap = root.querySelector<HTMLCanvasElement>('.minimap')!;
    this.nameInput = this.ref('name') as HTMLInputElement;
    this.passwordInput = this.ref('password') as HTMLInputElement;

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
      this.renderClass();
      this.actions.previewClass?.(this.currentClass);
    }));

    this.ref('leave').addEventListener('click', () => this.actions.leave());
    this.ref('social-toggle').addEventListener('click', () => this.toggleSocial());
    this.ref('social-close').addEventListener('click', () => this.toggleSocial(false));
    this.ref('target-close').addEventListener('click', () => this.actions.select(null));
    this.ref('target-friend').addEventListener('click', () => { if (this.selected) this.actions.social('friend-request', this.selected.id); });
    this.ref('target-team').addEventListener('click', () => { if (this.selected) this.actions.social('team-invite', this.selected.id); });

    this.ref('ability-bar').addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-slot]');
      if (button && !button.disabled) this.actions.cast(button.dataset.slot as AbilitySlot);
    });

    this.renderClass();
  }

  get selectedClass(): ClassId { return this.currentClass; }
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
    this.savedAccount = account;
    const hasSaved = Boolean(account);
    this.ref('saved-card').hidden = !hasSaved;
    this.ref('auth-box').hidden = hasSaved;

    if (hasSaved && account) {
      this.write('saved-name', account.name);
      this.write('saved-stats', `Livello ${levelFromXp(account.xp)} · ${account.kills} uccisioni`);
      this.write('lobby-gold', String(account.gold ?? 0));
      this.write('join-text', `Continua come ${account.name}`);
      this.nameInput.removeAttribute('required');
      this.passwordInput.removeAttribute('required');
    } else {
      this.write('join-text', this.authMode === 'login' ? 'Accedi ed entra' : 'Crea personaggio ed entra');
      this.nameInput.setAttribute('required', 'true');
      this.passwordInput.setAttribute('required', 'true');
      this.passwordInput.value = '';
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
    this.ref('class-detail').innerHTML = `<div class="class-detail-heading"><h3>${chosen.subtitle}</h3><div class="class-stats"><span><i class="stat-health"></i>${chosen.maxHp} PV</span><span><i class="stat-resource" style="background:${chosen.color}"></i>${chosen.maxResource} ${chosen.resource === 'rage' ? 'RAGE' : 'MANA'}</span></div></div><p>${chosen.description}</p><div class="lobby-abilities">${SLOTS.map(slot => `<div class="lobby-ability" title="${chosen.abilities[slot].description}"><kbd>${KEYS[slot]}</kbd><span>${chosen.abilities[slot].name}</span></div>`).join('')}</div>`;
  }

  setConnection(status: 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline', detail?: string): void {
    this.status = status;
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
      this.lastSanctuary = undefined;
      this.previousGold = undefined;
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
        return `<button class="ability-button" data-slot="${slot}" style="--ability-color:${ability.color}" aria-label="${ability.name} (${slot === 'basic' ? 'Spazio' : slot.toUpperCase()})" title="${ability.name} — ${ability.description}\n${ability.cost} ${definition.resource === 'rage' ? 'rabbia' : 'mana'} · ${ability.cooldown}s di recupero"><kbd>${KEYS[slot]}</kbd><span class="ability-art">${icon(ABILITY_ICONS[ability.kind])}</span><span class="ability-name">${ability.name}</span><span class="ability-cost">${ability.cost || '—'}</span><span class="cooldown-shade"></span><span class="cooldown-count"></span></button>`;
      }).join('');
    }
    this.write('player-name', player.name);
    this.write('player-level', `LV ${player.level}`);
    this.fill('hp-fill', player.hp / player.maxHp);
    this.write('hp-label', `${Math.ceil(player.hp)} / ${player.maxHp}`);
    this.fill('resource-fill', player.resource / player.maxResource);
    this.write('resource-label', `${Math.floor(player.resource)} / ${player.maxResource}`);
    this.fill('xp-fill', (player.xp % 100) / 100);
    this.write('coords', snapshot.sanctuary === 'safe' ? 'ZONA SICURA · NO PVP' : snapshot.sanctuary === 'combat' ? `VULNERABILE · ${Math.max(0, Math.ceil(((player.pvpUntil ?? 0) - snapshot.time) / 1000))}s` : snapshot.sanctuary === 'outside' ? 'PVP ATTIVO' : 'ISTANZA PVP');
    if (snapshot.sanctuary && this.lastSanctuary && snapshot.sanctuary !== this.lastSanctuary) {
      this.toast(snapshot.sanctuary === 'safe' ? 'Zona sicura: PvP disattivato.' : snapshot.sanctuary === 'combat' ? 'Sei ancora in combattimento: resti vulnerabile.' : 'Fuori dall’avamposto: PvP attivo.', 'info');
    }
    this.lastSanctuary = snapshot.sanctuary;
    this.write('online', String(snapshot.online));
    const gold = snapshot.gold ?? 0;
    this.goldWallet.textContent = String(gold);
    this.write('lobby-gold', String(gold));
    if (this.previousGold !== undefined && gold > this.previousGold) this.toast(`+${gold - this.previousGold} gold raccolti`, 'success');
    this.previousGold = gold;
    const gate = snapshot.arenaGate;
    const worldTip = this.root.querySelector<HTMLElement>('.world-tip');
    if (worldTip) worldTip.hidden = !!snapshot.matchEndsAt || !player.hidden;
    let arenaText = Math.hypot(player.x - ARENA_GATE.x, player.y - ARENA_GATE.y) < ARENA_GATE.radius + 55 ? 'Arena 1v1 · Entra nel cerchio per partecipare' : '';
    if (snapshot.matchEndsAt) {
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
    this.arenaStatus.dataset.phase = gate?.phase ?? (snapshot.matchEndsAt ? 'match' : 'idle');
    this.write('ping', Number.isFinite(ping) ? `${Math.round(ping)} ms` : '— ms');
    this.ref('ping').classList.toggle('high-ping', ping > 180);
    const remaining = Math.max(0, player.deadUntil - snapshot.time);
    this.ref('death').hidden = remaining <= 0;
    this.write('death-count', String(Math.ceil(remaining / 1000)));

    this.root.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(button => {
      const slot = button.dataset.slot as AbilitySlot;
      const ability = definition.abilities[slot];
      const cooldown = Math.max(0, player.cooldowns[slot] - snapshot.time);
      const safeBlocked = snapshot.sanctuary === 'safe' && ability.kind !== 'heal' && ability.kind !== 'shield';
      const unavailable = cooldown > 0 || player.resource < ability.cost || remaining > 0 || safeBlocked;
      button.disabled = unavailable;
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
  }

  setSocial(state: SocialState): void {
    this.socialState = state;
    this.ref('social-dot').hidden = !state.requests.length && !state.teamInvites.length;
    this.renderSocial();
  }

  setSelected(actor: Actor | null): void {
    if (actor?.id === this.latest?.self.id) actor = null;
    this.selected = actor;
    this.ref('target').hidden = !actor;
    if (!actor) return;
    this.write('target-type', actor.kind === 'npc' ? 'CREATURA DEL MONDO' : 'VIAGGIATORE');
    this.write('target-name', actor.name);
    this.write('target-detail', `${CLASSES[actor.classId].name} · Livello ${actor.level} · ${Math.ceil(actor.hp)} / ${actor.maxHp} PV`);
    if (actor.npcKind === 'warden') this.write('target-detail', actor.hp <= 0 ? `Cadavere · Ritorna tra ${Math.max(0, Math.ceil((actor.deadUntil - (this.latest?.time ?? 0)) / 1000))}s` : `Mini-boss · ${Math.ceil(actor.hp)} / ${actor.maxHp} PV`);
    this.fill('target-fill', actor.hp / actor.maxHp);
    this.ref('target-actions').hidden = actor.kind !== 'player';
    const isFriend = this.socialState?.friends.some(friend => friend.id === actor!.id);
    const sameTeam = !!actor.teamId && actor.teamId === this.latest?.self.teamId;
    (this.ref('target-friend') as HTMLButtonElement).disabled = !!isFriend;
    this.write('target-friend', isFriend ? '✓ Amico' : '+ Amico');
    (this.ref('target-team') as HTMLButtonElement).disabled = sameTeam;
    this.write('target-team', sameTeam ? '✓ Nel team' : '+ Team');
  }

  setLocation(name: string): void { this.write('biome', name); }

  private toggleSocial(open?: boolean): void {
    const panel = this.ref('social-panel');
    const visible = open ?? panel.hidden;
    panel.hidden = !visible;
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
    button.addEventListener('click', () => this.actions.social(action, id));
    return button;
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
      state.teamInvites.forEach(invite => requests.append(row(invite.name, 'Invito al team', [this.socialButton('Unisciti', 'team-accept', invite.id), this.socialButton('×', 'team-decline', invite.id)])));
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
    const toast = textElement('div', `toast toast-${tone}`, message);
    const stack = this.ref('toasts');
    stack.append(toast);
    while (stack.childElementCount > 4) stack.firstElementChild?.remove();
    window.setTimeout(() => {
      toast.classList.add('toast-leaving');
      window.setTimeout(() => toast.remove(), 250);
    }, tone === 'error' ? 6500 : 4200);
  }
}
