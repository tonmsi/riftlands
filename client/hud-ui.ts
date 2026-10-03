import { CLASS_ICONS, icon, portrait } from './ui-art';
import { CLASSES } from '../shared/config';
import { nearArenaGate } from '../shared/arena';
import { bindingLabel, defaultControls, type ControlSettings } from './controls';
import { GameDisplay } from './game-display';
import { InteractionUI } from './interaction-ui';
import { PopupManager } from './popups';
import { QuestJournalUI } from './quest-journal';
import type { NarrativeProgress } from '../shared/narrative';
import type { AbilitySlot, Actor, ClassId, Snapshot, SocialState } from '../shared/types';

import { SocialUI } from './social-ui';
import type { HudActions } from './ui-actions';
import { SLOTS, UIRefs, textElement } from './ui-dom';
const ABILITY_ICONS: Record<string, string> = {
  projectile: '<path d="m4 20 8-8M3 14l5-5M10 21l5-5M13 4l7-1-1 7-7 3-3-3Z"/>',
  melee: '<path d="m5 3 4 1 11 12-4 4L4 8ZM12 18l6-6M5 19l3-3M3 21l3-3"/>',
  area: '<circle cx="12" cy="12" r="4"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4 4l3 3M17 17l3 3M4 20l3-3M17 7l3-3"/>',
  heal: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"/>',
  shield: CLASS_ICONS.paladin,
  dash: '<path d="m11 3 9 9-9 9M3 6l6 6-6 6M6 12h14"/>',
  trap: '<circle cx="12" cy="12" r="8"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8"/>',
};

export interface HudHooks { entranceVisible(): boolean; }
export class HudUI {
  readonly interactions: InteractionUI;
  private readonly popups: PopupManager;
  private readonly journal: QuestJournalUI;
  public readonly canvas: HTMLCanvasElement;
  public readonly minimap: HTMLCanvasElement;
  public readonly compactMinimap = document.createElement('canvas');
  private activeClass: ClassId | null = null;
  private selected: Actor | null = null;
  private latest: Snapshot | null = null;

  private isPlaying = false;

  private readonly arenaStatus = document.createElement('div');
  private readonly goldWallet: HTMLElement;
  private controls = defaultControls();
  private readonly display: GameDisplay;
  private readonly exitDialog = document.createElement('dialog');
  private readonly mapToggle = document.createElement('button');
  private mapVisible = true;

  private readonly refs: UIRefs;
  private readonly social: SocialUI;
  constructor(private readonly root: HTMLElement, private readonly actions: HudActions, popups: PopupManager, private readonly hooks: HudHooks) {
    this.refs = new UIRefs(root.querySelector('.game-hud')!, root.querySelector('.toast-stack')!);
    this.social = new SocialUI(root.querySelector('.game-hud')!, actions, {
      selected: () => this.selected,
      refreshTarget: () => { if (this.selected) this.setSelected(this.selected); },
      closeOtherPanels: () => { this.toggleSettings(false); this.setMapVisible(false); },
    });
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
    this.popups = popups;
    this.interactions = new InteractionUI(root, command => this.actions.interact?.(command), message => this.toast(message), () => this.canvas.focus({ preventScroll: true }), this.popups);
    this.journal = new QuestJournalUI(root.querySelector('.game-hud')!, root.querySelector('.player-panel')!, this.popups);
    this.minimap = root.querySelector<HTMLCanvasElement>('.minimap')!;
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

    this.popups.register(this.exitDialog, () => this.exitDialog.open, () => { this.exitDialog.close(); this.display.resume(); });
    this.popups.register(mapPanel, () => this.mapVisible, () => this.setMapVisible(false), this.mapToggle);
    this.popups.register(this.ref('social-panel'), () => !this.ref('social-panel').hidden, () => this.social.toggle(false), this.ref('social-toggle'));
    this.popups.register(this.ref('settings-panel'), () => !this.ref('settings-panel').hidden, () => this.toggleSettings(false), this.ref('settings-toggle'));
    this.popups.register(this.ref('team-invite'), () => !this.ref('team-invite').hidden, () => { this.ref('team-invite').hidden = true; });

    this.ref('leave').addEventListener('click', () => this.confirmLeave());
    this.ref('settings-toggle').addEventListener('click', () => this.toggleSettings());
    this.ref('social-toggle').addEventListener('click', () => this.social.toggle());
    this.ref('social-close').addEventListener('click', () => this.social.toggle(false));
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
    this.ref('target-team').addEventListener('click', () => { if (this.selected) this.social.send('team-invite', this.selected.id); });

    this.ref('ability-bar').addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-slot]');
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !this.inputBlocked) this.actions.cast(button.dataset.slot as AbilitySlot);
    });
  }
  setSocial(state: SocialState): void { this.social.setSocial(state); }
  get minimapVisible(): boolean { return this.mapVisible; }
  get inputBlocked(): boolean { return this.hooks.entranceVisible() || this.exitDialog.open; }
  get touch(): boolean { return this.display.touch; }
  enterFullscreen(): void { if (this.display.touch) void this.display.enterFullscreen(); }
  resetJournal(): void { this.journal.reset(); }
  updateJournal(progress: NarrativeProgress): void { this.journal.update(progress); }
  private ref(name: string): HTMLElement { return this.refs.get(name); }
  private write(name: string, value: string): void { this.refs.write(name, value); }
  private fill(name: string, fraction: number): void { this.refs.fill(name, fraction); }
  private toggleSettings(open = this.ref('settings-panel').hidden): void {
    this.ref('settings-panel').hidden = !open;
    this.ref('settings-toggle').setAttribute('aria-expanded', String(open));
    if (open) { this.social.toggle(false); this.setMapVisible(false); }
  }

  private setMapVisible(visible: boolean): void {
    this.mapVisible = visible;
    if (visible) { this.toggleSettings(false); this.social.toggle(false); }
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

  setSelected(actor: Actor | null): void {
    if (actor?.id === this.latest?.self.id) actor = null;
    const summary = this.ref('target').querySelector<HTMLButtonElement>('.target-summary')!;
    if (actor?.id !== this.selected?.id) {
      this.ref('target').classList.remove('is-expanded');
      summary.setAttribute('aria-expanded', 'false');
    }
    this.selected = actor;
    this.social.setSelected(actor?.id);
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
    const isFriend = this.social.state?.friends.some(friend => friend.id === actor!.id);
    const sameTeam = !!actor.teamId && actor.teamId === this.latest?.self.teamId;
    (this.ref('target-friend') as HTMLButtonElement).disabled = !!isFriend;
    this.write('target-friend', isFriend ? '✓ Amico' : '+ Amico');
    const invited = this.social.hasPendingInvite(actor.id);
    (this.ref('target-team') as HTMLButtonElement).disabled = sameTeam || invited;
    this.write('target-team', sameTeam ? '✓ Nel team' : invited ? 'Inviato' : '+ Team');
  }

  setLocation(name: string): void { this.write('biome', name); this.write('map-location', name); }

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
  setControls(settings: ControlSettings): void {
    if (this.isPlaying) return;
    this.controls = structuredClone(settings); this.activeClass = null;
    const movement = settings.movement === 'mouse'
      ? `${settings.bindings.movePointer.map(bindingLabel).join(' / ')} tenuto: segui il cursore`
      : `${(['up', 'left', 'down', 'right'] as const).map(action => settings.bindings[action].map(bindingLabel).join('/')).join(' · ')}: muovi`;
    this.root.querySelector('.combat-instruction')!.textContent = `${movement} · Sinistro premuto: mira manuale · Senza mira: nemico più vicino · Clic sinistro: seleziona`;
    this.root.querySelector('.combat-caption > span:last-child')!.textContent = `${settings.bindings.basic.map(bindingLabel).join(' / ')} per attaccare`;
  }
  setPlaying(playing: boolean): void {
    if (!playing) this.popups.dismiss();
    if (!playing) this.setMapVisible(false);
    this.isPlaying = playing;
    this.toggleSettings(false);
    this.display.setPlaying(playing);
    if (!playing) this.exitDialog.close();
    this.root.classList.toggle('is-playing', playing);
    (this.root.querySelector('.game-hud') as HTMLElement).hidden = !playing;
    this.interactions.setVisible(playing);
    this.ref('connection-banner').hidden = true;
    if (playing) {
      if (!this.hooks.entranceVisible()) this.canvas.focus({ preventScroll: true });
    } else {
      this.social.toggle(false);
      this.setSelected(null);
      this.latest = null;
      this.activeClass = null;
      this.social.clear();
    }
  }
  setConnection(status: 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline', detail?: string): void {
    const banner = this.ref('connection-banner');
    banner.hidden = !this.isPlaying || (status !== 'offline' && status !== 'reconnecting');
    banner.textContent = status === 'reconnecting'
      ? `Riconnessione al mondo…${detail ? ` ${detail}` : ''}`
      : detail || 'Connessione interrotta. Torna al menu per riprovare.';
  }
  setSnapshot(snapshot: Snapshot, ping: number): void {
    this.interactions.update(snapshot);
    this.journal.update(snapshot.narrative, snapshot.inventory);
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
    this.social.setSnapshot(snapshot);
  }
}
