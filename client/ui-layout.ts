import { CLASSES } from '../shared/config';
import type { ClassId } from '../shared/types';
import { icon, portrait } from './ui-art';
/** Initial shell. Controllers update their own views after mounting. */
export function mountGameLayout(root: HTMLElement): void {
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
}
