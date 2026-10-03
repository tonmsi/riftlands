# Presentazione del client

La presentazione conserva due punti di ingresso per `main.ts`: `GameUI` e `Renderer`. Lo stato dei singoli sistemi appartiene ai componenti che lo usano; le operazioni che coinvolgono più viste passano attraverso il coordinatore.

## Interfaccia

| Modulo | Responsabilità e stato |
| --- | --- |
| `ui.ts` | Montaggio e coordinamento di menu, partita, connessione, controlli e ingresso. Espone la stessa API pubblica al client. |
| `lobby-ui.ts` | Login/registrazione, account salvato, classe selezionata, artwork, caricamento asset, navigazione e richieste `/api/lobby`. Conserva il controllo delle risposte obsolete. |
| `hud-ui.ts` | Snapshot corrente, classe attiva, bersaglio, vita/risorse, abilità, effetti, stato arena/dungeon, mappa, conferma di uscita e integrazione con journal e interazioni. |
| `social-ui.ts` | Amici, inviti, roster del team e attesa locale di tre secondi fra inviti. Consuma gli snapshot e legge il bersaglio tramite callback. |
| `world-entrance.ts` | Overlay di ingresso, animazione e timer. Attende almeno due secondi e il primo snapshot prima di chiudere la transizione; l'annullamento cancella frame e timeout. |
| `ui-layout.ts` | HTML iniziale della presentazione. |
| `ui-dom.ts` / `ui-art.ts` | Riferimenti DOM delle viste, piccoli helper, icone e ritratti. |

`ui-actions.ts` definisce il contratto del client e sottoinsiemi tipizzati per lobby, HUD e socialità. Per esempio, la lobby riceve le azioni di accesso e profilo; la UI social riceve selezione e comandi sociali. I componenti non ricevono l'istanza di `GameUI` e comunicano attraverso callback esplicite.

La classe scelta nel menu appartiene alla lobby; quella del personaggio attivo appartiene all'HUD. `GameUI.setSnapshot` aggiorna l'HUD, segnala la disponibilità del mondo alla transizione e inoltra il gold alla lobby. Un aggiornamento dell'HUD quindi non scrive direttamente nel menu.

Al ritorno al menu vengono chiusi i pannelli di gioco, cancellati la transizione e i timer degli inviti, e azzerati snapshot, bersaglio e stato social. Le preferenze dei controlli e la selezione della classe restano disponibili. Mappa e pannelli social mantengono il movimento attivo; ingresso e conferma di uscita bloccano l'input.

`ui.ts` passa da 1.054 a 82 righe. La riduzione conta soprattutto perché accesso, gioco e socialità ora hanno proprietari e contratti distinti.

## Renderer

`Renderer` mantiene mondo, camera, dimensioni, DPR, conversione delle coordinate del puntatore, selezione degli oggetti visibili e ordine dei passaggi. Conserva la composizione per profondità di attori e asset del mondo, oltre a dungeon, effetti e meteo.

`TerrainRenderer` possiede `EnvironmentArt` e la cache scorrevole del terreno. Riceve esplicitamente mondo e geometria del viewport. Invalida la cache quando cambiano i blocchi del mondo; il coordinatore segnala inoltre cambio seed, ridimensionamento e ripristino del contesto Canvas. Il riuso delle strisce del terreno resta nello stesso modulo della loro generazione.

`ActorRenderer` possiede caricamento delle sprite e stato delle animazioni di giocatori, NPC e boss, con i fallback procedurali. Il coordinatore gli comunica gli ID ancora presenti, così la storia delle animazioni scomparse viene liberata. Cambio seed azzera la storia del movimento. Risveglio e attacchi dei boss continuano a usare i tempi autorevoli.

`render-types.ts` raccoglie i contratti del frame e del viewport; `render-primitives.ts` raccoglie le primitive Canvas condivise. `RenderFrame` e `drawMinimap` restano esportati da `render.ts`, conservando gli import del client e dei maker.

`render.ts` passa da 1.837 a 920 righe; terreno e attori sono rispettivamente circa 410 e 499 righe. Eventuali ulteriori estrazioni dovranno seguire nuove responsabilità concrete, per esempio gli effetti, conservando centrale l'ordine del disegno.

## Verifica

Build TypeScript/Vite e sette test browser su lobby, HUD, interazioni, rendering del mondo, terreno e ricambio delle entità. Comando dei test browser, in sequenza:

```powershell
node --import tsx --test --test-concurrency=1 tests/integration/hud-browser.test.ts tests/integration/lobby-browser.test.ts tests/integration/client-load.test.ts tests/integration/world-render.test.ts tests/integration/terrain-browser.test.ts tests/integration/interaction-layout.test.ts
```

Le verifiche coprono tastiera e touch, layout desktop/mobile, caricamento e annullamento dell'ingresso, controlli personalizzati, conferma di uscita, ritorno al menu e reset degli inviti. Sul renderer controllano ordine dei layer, fade, cache, ripristino del contesto, DPR, equivalenza dei pixel fra cache scorrevole e ricostruzione completa. Nel ricambio sintetico di 2.000 entità restano una sola animazione dopo la rimozione delle entità e al massimo 2.001 voci durante il test.

Una esecuzione con i file browser in parallelo ha avuto un timeout sul movimento iniziale; quel test è passato nelle esecuzioni precedenti e nella verifica in sequenza. Le misure di tempo dei test headless sono osservazioni locali, non una certificazione di prestazioni.

La suite generale conserva il risultato precedente: 248 test, 231 passati e 17 fallimenti già noti, lasciati fuori da questo intervento. Rimane anche l'avviso Vite sul chunk degli asset del mondo sopra 500 kB. La separazione dei moduli migliora la manutenzione; il caricamento delle sprite resta eager e richiede un intervento distinto per ridurre download e memoria iniziale.
