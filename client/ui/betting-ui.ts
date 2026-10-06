import type { Snapshot } from '../../shared/types';
import type { BettingAction, ArenaMarket } from '../../shared/betting';
import { CLASSES } from '../../shared/config';
import './betting.css';
import { BetWinFeedback } from './bet-win-feedback';
import type { BetWin } from '../../shared/betting';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
};
export class BettingUI {
  readonly dialog = document.createElement('dialog');
  private snapshot?: Snapshot;
  private tab: 'markets' | 'bets' | 'arena' = 'bets';
  private signature = '';
  private broadcastSignature = '';
  private readonly content = el('div', 'betting-content');
  private readonly banner = el('div', 'arena-broadcast');
  private readonly balance = el('strong', 'betting-balance');
  private opener?: HTMLElement;
  private readonly title = el('h2');
  private readonly eyebrow = el('small');
  private readonly intro = el('p', 'betting-intro');
  private readonly foot = el('p', 'betting-foot');
  private readonly wins: BetWinFeedback;
  get visible() { return this.dialog.open || this.wins.visible; }
  constructor(private root: HTMLElement, private send: (action: BettingAction) => void, private release: () => void) {
    this.banner.hidden = true;
    this.wins = new BetWinFeedback(root, release);
    this.dialog.className = 'betting-dialog'; this.dialog.setAttribute('aria-label', 'Scommesse arena');
    const head = el('header', 'betting-header');
    const title = el('div'); title.append(this.eyebrow, this.title);
    const close = el('button', 'betting-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Chiudi scommesse');
    close.onclick = () => this.close(); head.append(title, close);
    this.dialog.append(head, this.intro, this.balance, this.content, this.foot); root.append(this.dialog, this.banner);
    const arenas = el('button', 'glass hud-menu-button arena-watch-launcher', '◉ Arene'); arenas.type = 'button'; arenas.setAttribute('aria-label', 'Assisti alle arene');
    arenas.onclick = () => this.open('arena');
    (root.querySelector('.game-top-right .menu-buttons') ?? root).append(arenas);
    this.dialog.addEventListener('cancel', () => this.release());
    this.dialog.addEventListener('close', () => { this.release(); this.opener?.focus({ preventScroll: true }); });
    for (const gold of root.querySelectorAll<HTMLElement>('.gold-counter')) {
      gold.tabIndex = 0; gold.setAttribute('role', 'button'); gold.setAttribute('aria-label', 'Gold e scommesse attive'); gold.title = 'Apri le tue scommesse';
      gold.onclick = () => this.open('bets');
      gold.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.open('bets'); } };
    }
  }
  open(tab: 'markets' | 'bets' | 'arena' = 'markets') {
    this.tab = tab; this.release(); this.signature = '';
    this.eyebrow.textContent = tab === 'bets' ? 'IL TUO PORTAFOGLIO' : tab === 'arena' ? 'ARENA 1VS1 · TRIBUNA' : 'SILAS · MAESTRO DELLE QUOTE';
    this.title.textContent = tab === 'bets' ? 'Le tue puntate' : tab === 'arena' ? 'Duelli in diretta' : 'Il banco dell’arena';
    this.intro.textContent = tab === 'bets' ? 'Puntate attive e ultimi 10 risultati.' : tab === 'arena' ? 'Assisti a qualsiasi duello, anche senza scommettere.' : 'Scegli il tuo campione. Le puntate chiudono alla partenza.';
    this.balance.hidden = tab === 'arena';
    this.foot.textContent = tab === 'bets' ? 'Le puntate attive restano qui fino al risultato del duello.' : tab === 'arena' ? 'Ingresso da vivo e fuori combattimento · Nessun controllo sui combattenti' : 'Quote da livello e K/D · Vincita inclusa la puntata · Pareggi e annullamenti rimborsati';
    if (!this.dialog.open) { this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; this.dialog.showModal(); }
    this.render();
  }
  close() { this.dialog.close(); }
  reset() { this.close(); this.wins.reset(); this.snapshot = undefined; this.broadcastSignature = ''; this.banner.replaceChildren(); this.banner.hidden = true; this.root.classList.remove('arena-spectating'); }
  win(win: BetWin) {
    const celebrate = win.celebrate && !this.snapshot?.betting?.inCombat;
    if (celebrate) this.close();
    this.wins.show({ ...win, celebrate });
  }
  update(snapshot: Snapshot) {
    this.snapshot = snapshot;
    this.wins.combat(!!snapshot.betting?.inCombat);
    this.root.classList.toggle('arena-spectating', !!snapshot.betting?.spectating);
    this.balance.textContent = `${snapshot.gold ?? 0} GOLD DISPONIBILI`;
    this.render(); this.broadcast();
  }
  private render() {
    const snapshot = this.snapshot, view = snapshot?.betting;
    if (!this.dialog.open || !snapshot || !view) return;
    const signature = JSON.stringify([this.tab, view.markets, view.bets, view.bookmakerNearby, snapshot.gold]);
    if (signature !== this.signature) {
      this.signature = signature; this.content.replaceChildren();
      if (this.tab === 'arena') {
        if (!view.markets.length) this.content.append(el('div', 'betting-empty', 'Nessun duello in corso. La tribuna aprirà al prossimo incontro.'));
        for (const market of view.markets) {
          const card = el('article', 'arena-watch-card');
          const status = el('small', 'market-status'); status.dataset.start = String(market.startsAt);
          card.append(status, el('h3', '', market.contenders.map(p => p.name).join(' vs ')), el('p', '', market.contenders.map(p => `${CLASSES[p.classId].name} · Lv ${p.level}`).join(' / ')), this.watchButton(market));
          this.content.append(card);
        }
      } else if (this.tab === 'markets') {
        if (!view.bookmakerNearby) this.content.append(el('p', 'betting-hint', 'Per puntare, raggiungi Silas accanto all’ingresso dell’arena.'));
        if (!view.markets.length) this.content.append(el('div', 'betting-empty', 'L’arena attende i suoi sfidanti. Le quote compariranno al prossimo duello.'));
        for (const market of view.markets) this.content.append(this.marketCard(market));
      } else {
        const bets = [...view.bets].sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.placedAt - a.placedAt);
        if (!bets.length) this.content.append(el('div', 'betting-empty', 'Nessuna puntata ancora. Vai da Silas e scegli il tuo campione.'));
        for (const bet of bets) {
          const card = el('article', `bet-ticket ${bet.status}`);
          const labels = { active: 'IN CORSO', won: 'VINTA', lost: 'PERSA', refunded: 'RIMBORSATA' };
          card.append(el('small', 'bet-status', labels[bet.status]), el('h3', '', bet.playerName), el('p', '', `${bet.stake} gold × ${bet.odds.toFixed(2)} · ${bet.status === 'active' ? 'Vincita possibile' : 'Accreditati'}: ${bet.status === 'active' ? Math.floor(bet.stake * bet.odds) : bet.payout} gold`));
          if (bet.status === 'active' && view.markets.some(m => m.id === bet.matchId)) {
            const watch = el('button', 'bet-watch', '◉ Assisti al duello'); watch.type = 'button';
            watch.onclick = () => { this.send({ kind: 'watch', matchId: bet.matchId }); this.close(); }; card.append(watch);
          }
          this.content.append(card);
        }
      }
    }
    for (const label of this.content.querySelectorAll<HTMLElement>('[data-start]')) {
      const seconds = Math.max(0, Math.ceil((Number(label.dataset.start) - snapshot.time) / 1000));
      label.textContent = this.tab === 'arena'
        ? seconds ? `INIZIO TRA ${seconds}s` : 'LIVE · DUELLO IN CORSO'
        : seconds ? `PUNTATE APERTE · ${seconds}s` : 'LIVE · PUNTATE CHIUSE';
    }
    for (const button of this.content.querySelectorAll<HTMLButtonElement>('[data-bet-start]')) if (Number(button.dataset.betStart) <= snapshot.time) button.disabled = true;
  }
  private marketCard(market: ArenaMarket) {
    const snapshot = this.snapshot!, view = snapshot.betting!;
    const card = el('article', 'arena-market');
    const status = el('small', 'market-status'); status.dataset.start = String(market.startsAt); card.append(status);
    const versus = el('div', 'market-versus');
    let selected = market.contenders[0].id;
    for (const [index, player] of market.contenders.entries()) {
      if (index) versus.append(el('span', 'market-vs', 'VS'));
      const choice = el('button', `contender ${index === 0 ? 'selected' : ''}`); choice.type = 'button'; choice.setAttribute('aria-pressed', String(index === 0));
      choice.style.setProperty('--fighter-color', CLASSES[player.classId].color);
      choice.append(el('small', '', `${CLASSES[player.classId].name} · LV ${player.level}`), el('h3', '', player.name), el('span', 'contender-kd', `${player.kills} uccisioni / ${player.deaths} morti`), el('strong', 'contender-odds', player.odds.toFixed(2)));
      choice.onclick = () => { selected = player.id; versus.querySelectorAll('button').forEach(b => { b.classList.toggle('selected', b === choice); b.setAttribute('aria-pressed', String(b === choice)); }); updatePayout(); };
      versus.append(choice);
    }
    card.append(versus);
    const existing = view.bets.find(b => b.matchId === market.id);
    card.append(this.watchButton(market));
    if (existing || market.phase !== 'open') return card;
    const form = el('form', 'bet-form');
    const label = el('label', '', 'Puntata in gold'); const input = el('input'); input.type = 'number'; input.min = '1'; input.max = String(Math.min(10000, snapshot.gold ?? 0)); input.step = '1'; input.value = String(Math.min(10, snapshot.gold ?? 0)); input.required = true;
    label.append(input); const payout = el('output', 'bet-payout');
    const updatePayout = () => payout.textContent = `Vincita possibile: ${Math.floor(Number(input.value) * market.contenders.find(p => p.id === selected)!.odds) || 0} gold`;
    input.oninput = updatePayout; updatePayout();
    const submit = el('button', 'bet-submit', 'Conferma puntata'); submit.type = 'submit'; submit.dataset.betStart = String(market.startsAt);
    submit.disabled = !view.bookmakerNearby || market.phase !== 'open' || market.contenders.some(p => p.id === snapshot.self.id) || (snapshot.gold ?? 0) < 1;
    form.onsubmit = event => { event.preventDefault(); submit.disabled = true; this.send({ kind: 'bet', matchId: market.id, playerId: selected, stake: Number(input.value) }); };
    form.append(label, payout, submit); card.append(form); return card;
  }
  private watchButton(market: ArenaMarket) {
    const watch = el('button', 'bet-watch', '◉ Assisti al duello'); watch.type = 'button';
    watch.disabled = !this.snapshot?.betting?.spectating && market.contenders.some(p => p.id === this.snapshot?.self.id);
    watch.onclick = () => { this.send({ kind: 'watch', matchId: market.id }); this.close(); }; return watch;
  }
  private broadcast() {
    const snapshot = this.snapshot!, view = snapshot.betting;
    const seconds = Math.max(0, Math.ceil(((view?.startsAt ?? 0) - snapshot.time) / 1000));
    this.banner.hidden = !view?.spectating && !seconds;
    if (this.banner.hidden) { this.broadcastSignature = ''; return; }
    const signature = `${view?.spectating ?? ''}:${!!seconds}`;
    if (this.broadcastSignature === signature) {
      this.banner.querySelector('.broadcast-title')!.textContent = seconds ? `Il duello inizia tra ${seconds}s` : 'Duello in diretta';
      for (const hp of this.banner.querySelectorAll<HTMLProgressElement>('progress')) hp.value = snapshot.actors.find(a => a.id === hp.dataset.player)?.hp ?? 0;
      return;
    }
    this.broadcastSignature = signature; this.banner.replaceChildren();
    this.banner.append(el('small', '', view?.spectating ? '◉ TRIBUNA · ARENA 1VS1' : 'ARENA 1VS1'));
    this.banner.append(el('strong', 'broadcast-title', seconds ? `Il duello inizia tra ${seconds}s` : 'Duello in diretta'));
    if (view?.spectating) {
      const market = view.markets.find(m => m.id === view.spectating);
      const fighters = el('div', 'broadcast-fighters');
      for (const player of market?.contenders ?? []) {
        const actor = snapshot.actors.find(a => a.id === player.id) ?? (snapshot.self.id === player.id ? snapshot.self : undefined);
        const row = el('div'); row.append(el('span', '', player.name));
        const hp = el('progress'); hp.dataset.player = player.id; hp.max = actor?.maxHp ?? 1; hp.value = actor?.hp ?? 0; hp.setAttribute('aria-label', `Vita di ${player.name}`); row.append(hp); fighters.append(row);
      }
      const exit = el('button', 'broadcast-exit', 'Esci dalla tribuna'); exit.type = 'button'; exit.onclick = () => this.send({ kind: 'exit' });
      this.banner.append(fighters, exit);
    } else this.banner.append(el('span', '', 'Silas accetta le ultime puntate. Preparati!'));
  }
}
