import { CLASSES } from '../../../shared/config';
import type { Actor, Snapshot, SocialState } from '../../../shared/types';
import type { SocialActions, SocialAction } from '../ui-actions';
import { icon, portrait } from '../ui-art';
import { UIRefs, textElement } from '../ui-dom';
export interface SocialHooks {
  selected(): Actor | null;
  refreshTarget(): void;
  closeOtherPanels(): void;
}
/** Social widgets consume snapshots but never own gameplay selection. */
export class SocialUI {
  private socialState: SocialState | null = null;
  private socialCache = '';
  private inviteKey = '';
  private rosterKey = '';
  private readonly inviteCooldowns = new Map<string, number>();
  private readonly inviteTimers = new Map<string, number>();
  private latest: Snapshot | null = null;
  private readonly refs: UIRefs;
  constructor(private readonly root: HTMLElement, private readonly actions: SocialActions, private readonly hooks: SocialHooks) {
    this.refs = new UIRefs(root);
  }
  get state(): SocialState | null { return this.socialState; }
  hasPendingInvite(id: string): boolean { return (this.inviteCooldowns.get(id) ?? 0) > Date.now(); }
  private ref(name: string): HTMLElement { return this.refs.get(name); }
  setSnapshot(snapshot: Snapshot): void {
    this.latest = snapshot;
    this.renderTeamRoster();
    this.updateInviteButtons();
  }
  setSelected(id?: string): void {
    for (const row of this.ref('team-roster').querySelectorAll<HTMLElement>('.team-member')) {
      row.setAttribute('aria-pressed', String(row.dataset.memberId === id));
    }
  }
  clear(): void {
    for (const timer of this.inviteTimers.values()) window.clearTimeout(timer);
    this.inviteTimers.clear();
    this.inviteCooldowns.clear();
    this.latest = null;
    this.socialState = null;
    this.ref('social-dot').hidden = true;
    this.toggle(false);
    this.renderSocial();
    this.renderTeamInvite();
    this.renderTeamRoster();
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
      row.setAttribute('aria-pressed', String(this.hooks.selected()?.id === member.id));
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

  toggle(open?: boolean): void {
    const panel = this.ref('social-panel');
    const visible = open ?? panel.hidden;
    panel.hidden = !visible;
    if (visible) { this.hooks.closeOtherPanels(); }
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
    button.addEventListener('click', () => this.send(action, id));
    return button;
  }

  send(action: SocialAction, id?: string): void {
    if (action === 'team-invite' && id) {
      if ((this.inviteCooldowns.get(id) ?? 0) > Date.now()) return;
      this.inviteCooldowns.set(id, Date.now() + 3000);
      this.updateInviteButtons();
      this.inviteTimers.set(id, window.setTimeout(() => {
        this.inviteTimers.delete(id);
        this.inviteCooldowns.delete(id);
        this.updateInviteButtons();
      }, 3000));
    }
    this.actions.social(action, id);
  }

  private updateInviteButtons(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-social-action="team-invite"]')) {
      const pending = (this.inviteCooldowns.get(button.dataset.targetId!) ?? 0) > Date.now();
      button.disabled = pending; button.textContent = pending ? 'Inviato' : '+ Team';
    }
    this.hooks.refreshTarget();
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
}
