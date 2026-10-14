# Review codice e mobile — 13 ottobre 2026

Aggiornamento successivo: è stata implementata una [prima ottimizzazione del movimento mobile](mobile-performance-2026-10-13.md), inclusi cache dei piani statici, filtro degli asset fuori vista e correzione dello zoom pesca. I rilievi sotto restano la fotografia precedente a quell'intervento.

La base è migliorata: renderer, UI e snapshot hanno confini più chiari, le cache principali sono limitate e la verifica aggiornata passa. Il lavoro utile ora riguarda caricamento degli asset, invalidazione del terreno e coerenza della UI touch. Non emerge la necessità di riscrivere il progetto.

La review considera i file locali, comprese le modifiche non committate. Durante il controllo sono comparsi nuovi moduli wall-sprite da un lavoro concorrente: il primo errore di import mancante è stato superato e build/test sono stati ripetuti. I risultati descrivono lo stato verificato durante questa sessione, non ogni eventuale modifica successiva. Non sono stati modificati codice applicativo, contenuti del mondo o salvataggi per questa review.

## Verifiche

| Controllo | Esito |
| --- | --- |
| `npm run build` | Superato; TypeScript e Vite. Chunk condiviso da 942,11 kB, avviso oltre 500 kB. |
| `npm test` | 465 test passati, nessun fallimento. |
| `tests/integration/hud-browser.test.ts` | 1 passato, 1 fallito: pannello mobile alto 64 px, test ancora fermo a 80 px. Il test completo del movimento dopo interazioni mappa/team passa. |
| Probe renderer in Edge | Riprodotta ricostruzione completa del terreno durante lo zoom pesca; dati sotto. |
| Harness CSS touch isolato | Misurate dimensioni finali e sovrapposizioni con hit testing. |
| Analisi riferimenti TypeScript | Tutti i moduli correnti client/server/shared risultano raggiungibili dai cinque ingressi runtime. Individuati metodi, stato e import inutilizzati. |

I test browser sono esecuzioni desktop/headless con touch emulato. Non certificano FPS, GPU, consumo energetico o memoria effettiva su Android/iPhone. Il test chiamato iOS cambia user agent ma usa Chromium, non WebKit.

## 1. P1 — Lo zoom pesca ricostruisce il terreno a ogni frame

`client/render/render.ts:155` interpola `fishingZoom` senza una soglia di arresto. `client/render/terrain-renderer.ts:87` richiede identità esatta della scala della cache; ogni variazione entra nel ramo che ridimensiona il canvas e ridisegna il terreno completo a riga 102.

Probe con un giocatore fermo sullo spawn corrente, viewport 844×390, touch, DPR dispositivo emulato 3 e DPR effettivo 1,5. Dopo il riscaldamento:

| Fase | Frame | Chiamate di ricostruzione terreno | CPU mediana della chiamata render | CPU p95 |
| --- | ---: | ---: | ---: | ---: |
| Normale | 60 | 0 | 1,5 ms | 2,6 ms |
| Entrata in fight | 60 | 60 | 99,1 ms | 227,0 ms |
| Uscita da fight | 60 | 60 | 111,2 ms | 359,6 ms |

È una misura locale di chiamate CPU sincrone, non una misura end-to-end degli FPS. Il probe forza il delta della formula a circa 1/60 s. La verifica numerica della formula corrente arriva a circa 458 variazioni prima della stabilizzazione floating point, cioè 7,6 secondi a 60 Hz per ciascuna transizione.

Intervento: mantenere una risoluzione stabile della cache durante lo zoom e riscalare la bitmap; stabilizzare lo zoom con epsilon. Una sola soglia finale riduce la coda ma lascia la ricostruzione a ogni frame durante l'animazione. Verificare sia riuso della cache sia qualità dei pixel durante e dopo lo zoom.

## 2. P2 — Avvio e memoria grafica ancora troppo costosi per mobile

`client/main.ts:142` lega la preparazione della lobby alla preparazione di tutte le sprite; `main.ts:86` attende la stessa promessa prima di entrare. `client/ui/lobby/lobby-assets.ts:49–65` precarica tutti gli sfondi di classe, anche quelli che il giocatore non selezionerà, e mantiene vive le immagini decodificate.

| Gruppo già precaricato | Dimensione dei file | Pixel RGBA nominali |
| --- | ---: | ---: |
| Sei immagini del manifest lobby | 14.741.667 byte | Circa 36 MiB |
| Dieci texture in TerrainMaterials | 15.819.245 byte | Circa 60 MiB |
| Frame delle skin NPC/boss predefinite | PNG sorgenti circa 6,14 MB, più SVG | Circa 55 MiB per 197 canvas |

Lobby e dieci texture da sole sommano **30,56 MB** di file, esclusi ritratti e sprite. Il probe del solo renderer ha osservato 33 richieste di asset per 30.742.705 byte di corpi codificati locali: è un insieme diverso da quello della lobby, non va sommato alla tabella come se non avesse sovrapposizioni.

`client/render/catalog-sprite-renderer.ts:20` prepara tutte le skin; `actor-sprite-renderer.ts:19` crea tutti i canvas alla risoluzione sorgente. Nel catalogo predefinito sono 10 skin e 16 sheet distinti. Il limite di 32 milioni di pixel è per sheet; non limita il totale conservato.

I pixel RGBA sono contabilità nominale dei buffer, non misure del consumo del browser. Intervento: immagini mobile ridimensionate e compresse, sfondi caricati alla selezione, skin caricate alla necessità con fallback, rasterizzazione alla dimensione utile e budget totale delle cache. Il PNG della lobby non deve bloccare l'accesso a una partita già pronta.

## 3. P2 — Posizioni dei controlli consentite possono coprire l'attacco

`client/controls/device-options.ts:15` permette spostamenti fino al 30%; `mobile-settings.ts:5` controlla soltanto intervalli numerici. `client/styles/mobile.css:23–29` limita ciascun controllo ai bordi dello schermo senza controllare il contatto con gli altri.

Su 390×844, con i quattro offset al 30%: joystick `(135,450.8,116,116)` e attacco base `(183,496.8,72,72)`. L'hit test al centro dell'attacco `(219,533)` restituisce il joystick. È una configurazione ammessa e salvabile che impedisce il tocco sul centro dell'attacco.

Intervento: vincolo geometrico fra movimento e abilità durante regolazione e resize, verificando anche preferenze già salvate. Testare il destinatario reale del pointer, non soltanto che ogni controllo sia dentro il viewport.

Su 320×568 anche il layout predefinito presenta sovrapposizioni fra player/menu e joystick/R. Il progetto dichiara `min-width:340px` in `client/styles/style.css:57`: questo è un limite di copertura da decidere, distinto dal problema riprodotto su 390px.

## 4. P2 — CSS mobile e test browser non sono allineati

Gli stili importati dopo `mobile.css` ne sovrascrivono alcune garanzie:

- `client/ui/hud/hud.css:212`: pulsanti menu 40×40 px.
- `hud.css:208`: chiusura bersaglio 32×32 px.
- `hud.css:179`: chiusura mappa 34×34 px.
- `hud.css:318`: pannello giocatore 64 px, contro gli 80 attesi da `tests/integration/hud-browser.test.ts:77`.

Le dimensioni sono verificate nel browser. La maggiore dimensione dichiarata da `mobile.css` non rappresenta la dimensione finale dei target. Consolidare la proprietà dei selettori touch e mantenere target almeno da 44 px, eventualmente separando dimensione visiva e area interattiva.

Inoltre `client/ui/hud/hud-ui.ts:131` rimuove `.world-location` per creare la mappa compatta, mentre `tests/e2e/mobile.spec.ts:26–59` continua a cercare il vecchio elemento e le coordinate. `npm test` include solo `tests/*.test.ts`: i 465 test verdi non includono i test browser in `tests/integration`.

Intervento: riallineare le aspettative alle decisioni di prodotto e includere nel controllo abituale una suite browser mobile mirata. Conservare asserzioni su accessibilità, hit testing, movimento e rotazione; non limitarsi a cambiare i numeri per ottenere verde.

## 5. P2 — Superfici statiche dipinte due volte e lavoro per piano ripetuto

`client/render/terrain-renderer.ts:160` inserisce tutte le superfici ground nella cache. `client/render/render.ts:416` richiama il disegno degli stessi livelli a ogni frame per rispettare l'occlusione fra piani. Il mondo esaminato contiene 69 celle ground sopraelevate e 148 bridge.

Il passaggio per piano serve, ma non richiede di rifare continuamente le parti statiche. Separare bitmap statiche per piano da fade e parti che coprono gli attori. Non eliminare semplicemente il passaggio live: cambierebbe l'ordine visivo fra attori e terreno. La review identifica il lavoro ripetuto; il suo costo isolato non è stato misurato.

`client/render/terrain-materials.ts:64` include l'elevazione nella chiave del pattern e ricrea lo stesso bitmap da 384×384 per trasformazioni diverse. Condividere il bitmap e separare le trasformazioni è un'altra possibilità. Il massimo teorico di 192 buffer è circa 108 MiB RGBA; non è la memoria misurata della mappa corrente.

## 6. P2 — Sincronizzazione team ripetuta a ogni accesso agli interni

`server/rooms.ts:83–84` cancella e ricopia tutti i team globali e i Set dei membri ogni volta che `interior()` viene chiamato, poi ricontrolla il team di ogni player. `simulationFor()` lo usa come getter a riga 98; tick, input e snapshot lo richiamano più volte.

Intervento: sincronizzazione su revisione del team o una volta per tick; getter privo di copie quando i dati non cambiano. È un costo ridondante verificato nel codice, non un collo di bottiglia misurato. Gli interni già aperti restano inoltre nella mappa e vengono simulati anche senza giocatori: valutare sospensione quando inattivi, rispettando persistenza e incontri.

## Codice inutile e duplicazioni da pulire

Non risultano grandi file TypeScript completamente scollegati. Le rimozioni concrete più semplici sono:

- `client/render/environment-art.ts:688`: metodo `ice()` non chiamato, circa 122 righe. Il ramo attuale usa già la texture del ghiaccio.
- `client/render/render.ts:751`: `drawVignette()` non chiamato; l'unico richiamo è commentato a riga 456.
- `server/boss-encounter.ts:50`: stato `killedBy` scritto e azzerato, mai letto.
- `shared/dungeons.ts:423`: coordinate `tx`/`ty` calcolate e non usate.
- Il controllo TypeScript aggiuntivo `--noUnusedLocals --noUnusedParameters` rileva 20 diagnostiche nel codice applicativo. Alcune riguardano import e parametri; utili per chiarezza, con impatto prestazionale generalmente piccolo.
- File `q`: vecchio elenco della cronologia Git, senza funzione runtime.
- README: mostra ancora `client/render/legacy/`, che non esiste; indica DPR 2 mentre il limite corrente è 1,5.

Ulteriori candidati di pulizia rilevati dal controllo aggiuntivo:

| File | Riga | Elemento |
| --- | ---: | --- |
| `client/core/combat-presentation.ts` | 1 | Import CLASSES |
| `client/editors/dungeon/dungeon-library.ts` | 1 | Import compactDungeonDraft |
| `client/editors/world/world-maker.ts` | 19 | Import newWorldAsset |
| `client/main.ts` | 10, 62 | Import CLASSES; nome del parametro classId nella callback |
| `client/render/minimap.ts` | 4 | Import DUNGEON_DEFINITIONS e dungeonAtTile |
| `client/render/render.ts` | 18 | Import DUNGEON_BY_BOSS_ID |
| `client/render/terrain-renderer.ts` | 4, 7 | Import dungeonAtTile e shorelineMask |
| `shared/world-authoring.ts` | 4 | Import tipo TileOverride |
| `shared/world.ts` | 11 | Import stairSurfaceId |
| `shared/progression.ts` | 21, 31 | Nomi dei parametri classId non usati |
| `client/controls/device-options.ts` | 8 | Proprietà private muteChanged non letta; conservare il parametro usato dalla closure |
| `client/ui/game-display.ts`, `client/ui/popups.ts` | 10 | Proprietà private root non lette; conservare i parametri usati dalle closure |

Il risultato dei flag aggiuntivi è distinto dalla build standard, che passa. Non rimuovere parametri dai contratti pubblici soltanto per soddisfare questi flag.

Le due immagini `public/world-assets/locanda/Cassa di legno rinforzata.png` e `Cassa-di-legno-rinforzata.png` hanno lo stesso SHA-256, ciascuna da 878.357 byte. Entrambe sono catalogate: consolidare riferimenti e bozze prima di rimuoverne una. Risparmio circa 0,84 MiB di distribuzione, senza dimostrazione di un guadagno nel frame rendering.

Non eliminare automaticamente asset perché assenti dalla scena corrente: molti appartengono alla libreria degli editor. `legacy-water-rocks.ts` è usato per compatibilità del terreno; `client/render/sprite-direction.ts` è un piccolo reexport, non una seconda implementazione. La copia dell'artwork della scogliera è documentata come sorgente intenzionale. Lo ZIP da 16,35 MB in public pesa sulla distribuzione, ma non è un download del gioco se non richiesto.

## Bundle e consegna degli asset

La pagina gioco precarica il chunk condiviso da 942,11 kB. Separare solamente i file TypeScript non lo riduce: mondo e dungeon restano importati subito. Il catalogo dungeon da 444.005 byte contiene circa 187.645 byte di bozze; valutare un formato runtime compilato separato dall'authoring.

Vite riporta 202,60 kB gzip per il chunk, ma questa è una stima della build. `server/index.ts:181–184` invia il file direttamente senza compressione HTTP. Aggiungere compressione al server o al proxy di distribuzione permette di realizzare quel risparmio. Le immagini hanno nomi stabili e `no-cache` senza ETag/Last-Modified nel percorso server: valutare URL versionate e cache persistente per evitare trasferimenti completi a ogni nuova verifica.

## Ordine consigliato

1. Eliminare le ricostruzioni del terreno durante lo zoom pesca.
2. Ridurre il precaricamento e la risoluzione delle risorse mobile.
3. Impedire sovrapposizioni dei controlli e consolidare gli stili touch.
4. Riallineare e rendere abituali i test browser mobile.
5. Togliere metodi/stato inutilizzati; rendere il disegno statico per piano e le sincronizzazioni team meno ripetitivi.
6. Misurare su almeno un Android di fascia media e un iPhone: primo accesso e riapertura, esplorazione, pesca, zone con molti asset e giocatori; p95 dei frame, memoria e traffico.

Conservare: autorità server, predizione, delta/keyframe degli snapshot, cache limitate, reset touch, safe area, visualViewport, pausa della tab nascosta, budget DPR 1,5/3 milioni di pixel e minimappa a 250 ms.

## Evidenze riproducibili

Log e probe locali sono in `artifacts/code-review-2026-10-13/` (cartella ignorata da Git): `build.log`, `unit-tests.log`, `hud-browser.log`, `render-probe.mjs`, `render-probe.json`. Il probe si avvia dalla radice con `node artifacts/code-review-2026-10-13/render-probe.mjs`; apre un server Vite e un browser isolati, senza account né salvataggi di gioco.
