import { CLASSES, levelFromXp } from '../../../shared/config';
import { bindingLabel, defaultControls, type ControlSettings } from '../../controls/controls';
import { renderCompletedQuests } from '../hud/quest-journal';
import { newNarrativeProgress, type NarrativeProgress } from '../../../shared/narrative';
import type { LobbyArt } from './lobby-assets';
import type { AbilitySlot, ClassId, PublicAccount, SocialState } from '../../../shared/types';
import type { ConnectionStatus, LobbyActions } from '../ui-actions';
import { ABILITY_ICONS, icon, portrait } from '../ui-art';
import { SLOTS, UIRefs, textElement } from '../ui-dom';
import { availableSpells, buildAccent, buildCost, newCharacter, normalizeLoadout, unlockTier, type Loadout, type SpellId } from '../../../shared/progression';
export interface LobbyHooks {
  configureControls(settings: ControlSettings): void;
  enterWorld(art?: string): void;
  entranceVisible(): boolean;
  resetJournal(): void;
  updateJournal(progress: NarrativeProgress): void;
  isTouch(): boolean;
  toast(message: string, tone: 'error'): void;
}
export class LobbyUI {
  private currentClass: ClassId = 'mage';
  private status: ConnectionStatus = 'idle';
  private isPlaying = false;
  private authMode: 'login' | 'register' = 'login';
  private savedAccount: PublicAccount | null = null;
  private menuScreen: 'auth' | 'character' | 'hub' = 'auth';
  private assetsLoaded = false;
  private lobbyArt: LobbyArt = { classes: {} };
  private readonly nameInput: HTMLInputElement;
  private readonly passwordInput: HTMLInputElement;
  private controls = defaultControls();
  private lobbyRequest = 0;
  private draftBuild: Loadout = { q: 'q', e: null };
  private savingBuild = false;
  private buildPicker?: HTMLDialogElement;
  private readonly refs: UIRefs;
  constructor(private readonly root: HTMLElement, private readonly actions: LobbyActions, private readonly hooks: LobbyHooks) {
    this.refs = new UIRefs(root.querySelector('.lobby')!, root.querySelector('.menu-boot')!);
    this.nameInput = this.ref('name') as HTMLInputElement;
    this.passwordInput = this.ref('password') as HTMLInputElement;
    try {
      const stored = localStorage.getItem('riftlands.selected-class');
      if (stored && Object.hasOwn(CLASSES, stored)) this.currentClass = stored as ClassId;
    } catch { /* Selection remains available without browser storage. */ }

    const optionsButton = document.createElement('button'); optionsButton.type = 'button';
    optionsButton.className = 'options-button'; optionsButton.textContent = 'Impostazioni'; optionsButton.hidden = true;
    optionsButton.addEventListener('click', () => this.showHub('settings'));
    root.querySelector('.header-right')!.prepend(optionsButton);

    root.querySelectorAll<HTMLButtonElement>('[data-screen-target]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.screenTarget === 'character') { this.menuScreen = 'character'; this.renderMenu(); }
      else this.showHub(button.dataset.screenTarget!);
    }));
    this.ref('configure-controls').addEventListener('click', () => this.hooks.configureControls(this.controls));
    this.ref('champion-info-toggle').addEventListener('click', () => {
      const open = this.ref('class-detail').classList.toggle('is-mobile-open');
      this.ref('champion-info-toggle').setAttribute('aria-expanded', String(open));
      this.ref('champion-info-toggle').textContent = open ? 'Chiudi statistiche' : 'Statistiche e abilità';
    });
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
        if (this.savingBuild || this.buildChanged()) { this.hooks.toast('Salva o annulla la modifica della build prima di entrare.', 'error'); return; }
        if (!this.assetsLoaded) return;
        this.hooks.enterWorld(this.lobbyArt.classes[this.currentClass]?.background ?? this.lobbyArt.selectionBackground ?? this.lobbyArt.loginBackground);
        this.actions.joinSaved(this.currentClass);
        return;
      }

      const name = this.nameInput.value.trim();
      const password = this.passwordInput.value;
      if (!name || !password) {
        this.hooks.toast('Compila nome e password per procedere.', 'error');
        return;
      }
      this.actions.joinCredentials(this.authMode, name, password, this.currentClass);
    });

    root.querySelectorAll<HTMLButtonElement>('[data-class]').forEach(button => button.addEventListener('click', () => {
      this.currentClass = button.dataset.class as ClassId;
      try { localStorage.setItem('riftlands.selected-class', this.currentClass); } catch { /* Optional preference. */ }
      this.renderClass();
      void this.refreshLobby();
      this.actions.previewClass?.(this.currentClass);
    }));

    this.renderClass();
  }
  get selectedClass(): ClassId { return this.currentClass; }
  private ref(name: string): HTMLElement { return this.refs.get(name); }
  private write(name: string, value: string): void { this.refs.write(name, value); }
  private keyLabel(slot: AbilitySlot): string { return bindingLabel(this.controls.bindings[slot][0]); }

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
    const draft = !changed && this.buildChanged() ? { ...this.draftBuild } : undefined;
    if (changed || !account) { this.hooks.resetJournal(); renderCompletedQuests(this.ref('completed-quests'), newNarrativeProgress()); }
    this.savedAccount = account;
    this.renderClass(draft);
    this.renderLobbyStats();
    if (changed) void this.refreshLobby();
    const hasSaved = Boolean(account);
    if (changed || !hasSaved) this.menuScreen = hasSaved ? 'character' : 'auth';
    this.ref('saved-card').hidden = !hasSaved;
    this.ref('auth-box').hidden = hasSaved;

    if (hasSaved && account) {
      this.write('saved-name', account.name);
      this.write('saved-stats', `${CLASSES[this.currentClass].name} · Livello ${levelFromXp(this.characterXp())}`);
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
    const entryActions = this.root.querySelector<HTMLElement>('.entry-actions')!;
    const playContainer = this.menuScreen === 'auth' ? this.ref('entry-form') : this.root.querySelector<HTMLElement>('.champion-stage')!;
    if (entryActions.parentElement !== playContainer) playContainer.append(entryActions);
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

  updateJoinAvailability(): void {
    (this.ref('join') as HTMLButtonElement).disabled = this.status === 'connecting' || this.status === 'reconnecting' || this.hooks.entranceVisible() || (Boolean(this.savedAccount) && !this.assetsLoaded);
  }

  private renderLobbyStats(): void {
    const container = this.ref('lobby-stats');
    container.replaceChildren();
    if (!this.savedAccount) { container.textContent = 'Accedi per vedere i tuoi progressi.'; return; }
    const a = this.savedAccount;
    const grid = document.createElement('dl'); grid.className = 'profile-stats';
    for (const [label, value] of [['Personaggio', CLASSES[this.currentClass].name], ['Livello', levelFromXp(this.characterXp())], ['Esperienza', this.characterXp()], ['Uccisioni', a.kills], ['Morti', a.deaths], ['Gold', a.gold ?? 0]]) {
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
      const response = await fetch('/api/lobby?classId=' + this.currentClass, { headers: token ? { Authorization: 'Bearer ' + token } : {}, signal: AbortSignal.timeout(8000) });
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
        this.hooks.updateJournal(narrative); renderCompletedQuests(this.ref('completed-quests'), narrative);
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

  private renderClass(draft?: Loadout): void {
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
      let badge = button.querySelector<HTMLElement>('.class-level');
      if (!badge) { badge = document.createElement('span'); badge.className = 'class-level'; button.append(badge); }
      badge.textContent = 'LV ' + levelFromXp(this.savedAccount?.characters?.[button.dataset.class as ClassId]?.xp ?? newCharacter(button.dataset.class as ClassId).xp);
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
      const unlock = slot === 'basic' ? 'Base' : slot === 'q' ? 'LV 3' : slot === 'e' ? 'LV 6' : 'LV 10';
      return `<div class="lobby-ability" title="${ability.description}"><kbd>${unlock}</kbd><span><strong>${ability.name}</strong><small>Ricarica ${number(ability.cooldown)} s${ability.cost ? ` · ${ability.cost} ${chosen.resource === 'rage' ? 'rabbia' : 'mana'}` : ' · nessun costo'}</small></span></div>`;
    }).join('')}</div>`;
    this.renderBuild(draft);
    this.write('saved-stats', `${chosen.name} · Livello ${levelFromXp(this.characterXp())}`);
    this.renderLobbyStats();
  }

  private characterXp(): number { return this.savedAccount?.characters?.[this.currentClass]?.xp ?? newCharacter(this.currentClass).xp; }
  private savedBuild(): Loadout { return normalizeLoadout(this.savedAccount?.characters?.[this.currentClass]?.loadout, levelFromXp(this.characterXp()), this.currentClass); }
  private buildChanged(): boolean { return JSON.stringify(this.draftBuild) !== JSON.stringify(this.savedBuild()); }
  private renderBuild(draft = this.savedBuild()): void {
    const container = this.ref('build-editor'), level = levelFromXp(this.characterXp()), chosen = CLASSES[this.currentClass];
    const nextBuild = normalizeLoadout(draft, level, this.currentClass);
    const picker = this.buildPicker;
    if (picker && (this.savingBuild || picker.dataset.classId !== this.currentClass || picker.dataset.level !== String(level) || JSON.stringify(nextBuild) !== JSON.stringify(this.draftBuild))) picker.close();
    this.draftBuild = nextBuild;
    container.replaceChildren();
    const heading = document.createElement('header'); heading.className = 'build-heading';
    const title = document.createElement('div');
    title.append(textElement('span', 'eyebrow', 'IL TUO STILE DI COMBATTIMENTO'), textElement('h3', '', 'La tua build'));
    heading.append(title, textElement('span', 'build-level', `Livello ${level}`)); container.append(heading);
    container.style.setProperty('--build-accent', buildAccent({ classId: this.currentClass, loadout: this.draftBuild }) ?? chosen.color);
    const fields = document.createElement('div'); fields.className = 'build-slots';
    for (const slot of ['basic', 'q', 'e'] as const) {
      const id = slot === 'basic' ? 'basic' : this.draftBuild[slot];
      const ability = id ? chosen.abilities[id] : undefined;
      const card = document.createElement(slot === 'basic' ? 'div' : 'button'); card.className = 'build-slot'; card.dataset.buildSlot = slot;
      card.style.setProperty('--spell-color', ability?.color ?? '#8fa4b6');
      card.innerHTML = `<span class="build-slot-orb">${ability ? icon(ABILITY_ICONS[ability.kind]) : icon('<path d="M8 11V7a4 4 0 0 1 8 0v4"/><rect x="5" y="11" width="14" height="10" rx="3"/>')}<kbd>${slot === 'basic' ? 'BASE' : this.keyLabel(slot)}</kbd></span>`;
      const copy = document.createElement('span'); copy.className = 'build-slot-copy';
      copy.append(textElement('small', '', slot === 'basic' ? 'SEMPRE EQUIPAGGIATO' : slot === 'q' ? 'PRIMO SLOT' : 'SECONDO SLOT'), textElement('strong', '', ability?.name ?? 'Slot bloccato'), textElement('span', '', slot === 'basic' ? 'Attacco fisso' : !ability ? 'Si sblocca al livello ' + (slot === 'q' ? 3 : 6) : level < 3 ? 'Primo attacco al livello 3' : 'Tocca per scegliere'));
      card.append(copy);
      if (card instanceof HTMLButtonElement) {
        card.type = 'button'; card.disabled = this.savingBuild || !this.savedAccount || !ability || level < 3;
        card.setAttribute('aria-label', `Abilità ${slot.toUpperCase()}: ${ability?.name ?? 'bloccata'}`);
        card.setAttribute('aria-haspopup', 'dialog');
        card.dataset.spell = id ?? '';
        card.addEventListener('click', () => this.openBuildPicker(slot as 'q' | 'e'));
      }
      fields.append(card);
    }
    container.append(fields);
    const summary = this.savedAccount?.characters?.[this.currentClass];
    const cost = buildCost({ xp: this.characterXp(), loadout: this.savedBuild(), configuredTier: summary?.freeBuild ? 0 : unlockTier(level) }, this.draftBuild, this.currentClass);
    const actions = document.createElement('div'); actions.className = 'build-actions';
    const save = document.createElement('button'); save.type = 'button'; save.textContent = this.savingBuild ? 'Salvataggio…' : `Salva build · ${cost ? cost + ' gold' : 'Gratis'}`;
    save.disabled = this.savingBuild || !this.savedAccount || !this.buildChanged() || (this.savedAccount.gold ?? 0) < cost;
    save.addEventListener('click', () => void this.saveBuild());
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Annulla'; cancel.disabled = this.savingBuild || !this.buildChanged(); cancel.addEventListener('click', () => this.renderBuild());
    actions.append(save, cancel);
    const hint = level < 3 ? 'Livello 1: attacco base · Livello 3: primo attacco · Livello 6: secondo attacco · Livello 10: scelta ampliata' : summary?.freeBuild ? 'Una configurazione gratuita disponibile dopo lo sblocco.' : 'Cambiare combinazione costa 10 gold. Invertire gli slot è gratuito.';
    const footer = document.createElement('footer'); footer.className = 'build-footer';
    footer.append(textElement('small', 'build-hint', hint), actions); container.append(footer, textElement('span', 'build-status', ''));
  }
  private openBuildPicker(slot: 'q' | 'e'): void {
    const level = levelFromXp(this.characterXp()), chosen = CLASSES[this.currentClass];
    if (!this.savedAccount || this.savingBuild || level < 3 || (slot === 'e' && level < 6)) return;
    this.buildPicker?.close();
    const dialog = document.createElement('dialog'); dialog.className = 'build-picker'; this.buildPicker = dialog;
    dialog.dataset.classId = this.currentClass; dialog.dataset.level = String(level);
    dialog.setAttribute('aria-labelledby', 'build-picker-title');
    dialog.style.setProperty('--selected-class', chosen.color);
    dialog.innerHTML = `<header><div><span class="eyebrow">PREPARA IL TUO PERSONAGGIO</span><h3 id="build-picker-title">Scegli un attacco</h3></div><button type="button" class="build-picker-close" aria-label="Chiudi scelta attacchi">×</button></header><p class="build-picker-intro">Scegli cosa equipaggiare sullo slot <b>${this.keyLabel(slot)}</b>.</p><div class="spell-wheel"><div class="spell-wheel-orbit"></div><div class="spell-wheel-center"><span>SLOT</span><strong>${this.keyLabel(slot)}</strong><small>${chosen.name}</small></div></div><div class="spell-preview" aria-live="polite"></div><small class="build-picker-note">La scelta viene applicata quando salvi la build.</small>`;
    const wheel = dialog.querySelector('.spell-wheel')!, detail = dialog.querySelector<HTMLElement>('.spell-preview')!;
    const available = availableSpells(level);
    const describe = (id: SpellId) => {
      const ability = chosen.abilities[id], required = id === 'q' ? 3 : id === 'e' ? 6 : 10;
      detail.replaceChildren(textElement('strong', '', ability.name), textElement('p', '', ability.description), textElement('small', '', `${level < required ? `Si sblocca al livello ${required} · ` : ''}${ability.damage ? `${ability.damage} danni · ` : ''}${ability.cooldown} s di recupero${ability.cost ? ` · ${ability.cost} ${chosen.resource === 'rage' ? 'rabbia' : 'mana'}` : ''}`));
      detail.style.setProperty('--spell-color', ability.color);
    };
    for (const [index, id] of (['q', 'e', 'r'] as const).entries()) {
      const ability = chosen.abilities[id], locked = !available.includes(id), current = this.draftBuild[slot] === id;
      const other = slot === 'q' ? 'e' : 'q', moves = this.draftBuild[other] === id;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'spell-choice';
      button.dataset.spell = id; button.dataset.position = String(index); button.style.setProperty('--spell-color', ability.color);
      button.disabled = locked; button.setAttribute('aria-pressed', String(current)); button.setAttribute('aria-label', ability.name);
      button.innerHTML = `<span class="spell-choice-orb">${icon(ABILITY_ICONS[ability.kind])}${current ? '<i aria-hidden="true">✓</i>' : ''}</span>`;
      button.append(textElement('strong', '', ability.name), textElement('small', '', locked ? 'LIVELLO ' + (id === 'q' ? 3 : id === 'e' ? 6 : 10) : current ? 'EQUIPAGGIATO' : moves ? 'SPOSTA DA ' + this.keyLabel(other) : 'DISPONIBILE'));
      button.addEventListener('mouseenter', () => describe(id)); button.addEventListener('focus', () => describe(id));
      button.addEventListener('click', () => {
        const next = { ...this.draftBuild, [slot]: id };
        if (moves && slot === 'q') next.e = this.draftBuild.q;
        else if (moves) next.q = this.draftBuild.e!;
        dialog.close(); this.renderBuild(next);
        this.ref('build-editor').querySelector<HTMLButtonElement>(`[data-build-slot="${slot}"]`)?.focus();
      });
      wheel.append(button);
    }
    describe(this.draftBuild[slot]!);
    dialog.querySelector('.build-picker-close')!.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (this.buildPicker === dialog) { this.buildPicker = undefined; this.ref('build-editor').querySelector<HTMLButtonElement>(`[data-build-slot="${slot}"]`)?.focus({ preventScroll: true }); }
    });
    this.root.append(dialog); dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('.spell-choice[aria-pressed="true"]')?.focus();
  }
  private async saveBuild(): Promise<void> {
    const classId = this.currentClass, loadout = { ...this.draftBuild };
    const token = this.actions.lobbyToken?.() ?? localStorage.getItem('riftlands.jwt');
    if (!token || this.savingBuild || !this.buildChanged()) return;
    ++this.lobbyRequest;
    this.savingBuild = true; this.renderBuild(loadout);
    let saved = false;
    try {
      const response = await fetch('/api/build', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ classId, loadout }), signal: AbortSignal.timeout(8000) });
      const data = await response.json() as { account?: PublicAccount; error?: string };
      if (!response.ok || !data.account) throw new Error(data.error ?? 'Salvataggio non riuscito.');
      this.setSavedAccount(data.account);
      saved = true;
    } catch (error) { this.hooks.toast(error instanceof Error ? error.message : 'Salvataggio non riuscito.', 'error'); }
    finally { this.savingBuild = false; this.renderBuild(!saved && this.currentClass === classId ? loadout : this.savedBuild()); }
  }
  setConnection(status: 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline', detail?: string): void {
    this.status = status;
    const optionsButton = this.root.querySelector<HTMLButtonElement>('.options-button');
    if (optionsButton) optionsButton.disabled = this.isPlaying || status === 'connecting' || status === 'reconnecting';
    const labels = { idle: '', connecting: 'Connessione in corso', online: '', reconnecting: 'Riconnessione…', offline: 'Connessione interrotta' };
    const pill = this.ref('lobby-connection');
    pill.dataset.status = status;
    pill.querySelector('span')!.textContent = detail || labels[status];
    pill.hidden = status === 'idle' || status === 'online';
    this.updateJoinAvailability();
  }
  setPlaying(playing: boolean): void {
    this.isPlaying = playing;
    this.root.querySelector<HTMLElement>('.lobby')!.hidden = playing;
    this.root.querySelector<HTMLButtonElement>('.options-button')!.disabled = playing || this.status === 'connecting' || this.status === 'reconnecting';
    if (!playing) void this.refreshLobby();
  }
  setGold(gold: number): void { this.write('lobby-gold', String(gold)); }
  setControls(settings: ControlSettings): void {
    if (this.isPlaying) return;
    this.controls = structuredClone(settings); this.renderClass();
    const movement = settings.movement === 'mouse'
      ? `${settings.bindings.movePointer.map(bindingLabel).join(' / ')} tenuto: segui il cursore`
      : `${(['up', 'left', 'down', 'right'] as const).map(action => settings.bindings[action].map(bindingLabel).join('/')).join(' · ')}: muovi`;
    this.root.querySelector('.lobby-controls')!.textContent = this.hooks.isTouch()
      ? 'Joystick: muovi · Trascina le abilità direzionali per mirare, rilascia per usarle · Tocca per mirare al nemico più vicino · Tocca i personaggi per selezionarli'
      : `${movement} · ${settings.bindings.basic.map(bindingLabel).join(' / ')}: attacca · ${(['q', 'e', 'r'] as const).map(slot => this.keyLabel(slot)).join(' / ')}: abilità · Sinistro premuto: mira manuale · Senza mira: nemico più vicino`;
  }
}
