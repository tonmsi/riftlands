# Analisi delle performance grafiche e di rete — 23/09/2026

## Sintesi

I rischi principali sono il volume degli snapshot JSON nelle zone affollate, il costo della simulazione quando i giocatori esplorano aree diverse e i picchi del renderer Canvas durante la generazione del terreno e gli effetti di combattimento. Una GPU più potente non risolve da sola parsing JSON, simulazione e lavoro JavaScript sul thread principale.

Il progetto contiene già diverse ottimizzazioni: non emerge una cache del mondo illimitata né un rendering SVG ripetuto per ogni personaggio a ogni frame. Le priorità sono misurare i picchi residui e ridurre traffico e lavoro ripetuto senza eliminare informazioni di gioco necessarie.

## Metodo e limiti

- Analisi del codice presente nella cartella di lavoro, comprese le modifiche locali già esistenti. I riferimenti `file:riga` indicano questa versione e possono cambiare con modifiche successive.
- Eseguito il microbenchmark esistente `node --import tsx scripts/benchmark-server.ts`, senza avviare il dev server. Il primo tentativo è stato bloccato dal sandbox; il secondo si è concluso correttamente.
- Nessuna modifica al codice applicativo. Nessun test su dispositivi fisici, GPU, browser mobili, TLS o collegamenti WAN in questa analisi.
- Le misure riportate sono di una singola esecuzione locale; non certificano una capacità massima di utenti né gli FPS sui dispositivi.
- Il documento copre le principali classi di dispositivi. Non è possibile garantire prestazioni su ogni modello attraverso la sola lettura del codice.

## Architettura e protezioni già presenti

| Area | Comportamento attuale | Riferimento |
| --- | --- | --- |
| Frequenze | Simulazione/input a 30 Hz, snapshot a 15 Hz; rendering a 60 FPS in partita e 30 nel menu | `shared/config.ts:3`, `client/main.ts:252`, `client/main.ts:268` |
| Risoluzione | DPR massimo 1,5 e budget di circa 3 milioni di pixel per il canvas principale | `client/frame-budget.ts:2` |
| Campo visivo | Limite al viewport logico; evita di generare terreno smisurato con zoom del browser ridotto | `client/render.ts:36`, `client/render.ts:232` |
| Terreno | Bitmap con margine, copia della parte riutilizzabile e ridisegno delle strisce esposte | `client/render.ts:507` |
| Sprite | Rasterizzazione iniziale in piccoli canvas; successivi frame via `drawImage` | `client/render.ts:55` |
| Visibilità | Attori filtrati prima dell'ordinamento; proiettili ed eventi hanno controlli di visibilità | `client/render.ts:347`, `client/render.ts:1547`, `client/render.ts:1587` |
| Cache | Mondo limitato a 160 chunk; decorazioni limitate per numero e pixel, acqua a 512 voci | `shared/world.ts:32`, `client/environment-art.ts:69`, `client/environment-art.ts:176` |
| Memoria temporanea | Buffer massimo 32 snapshot, indici WeakMap e rimozione della storia superata; massimo 1.024 eventi nel client | `client/snapshots.ts:6`, `client/main.ts:140` |
| Rete lenta | Scarto di nuovi snapshot se la socket server ha già dati in coda; limite anche sul client | `server/index.ts:107`, `server/index.ts:127`, `client/net.ts`, metodo `send` |
| Background | Rendering e input sospesi con documento nascosto; connessione e ricezione restano attive | `client/main.ts:197`, `client/main.ts:225`, `client/main.ts:265` |

La review storica `tests/client-performance-review.md` riporta un precedente limite DPR di 2: per questa analisi fa fede il codice attuale, che usa 1,5. I suoi risultati browser del 18 settembre non sono nuove misure del 23 settembre.

## Rischi grafici e del client

### G1 — Picchi di generazione del terreno, priorità alta

**Dove:** `client/render.ts:507` (`drawCachedTerrain`), `client/render.ts:561` (`drawTerrain`), `shared/world.ts:91` (`getChunk`), `client/environment-art.ts:176`.

La cache evita di ridisegnare tutto il terreno continuamente. Quando la camera esce dal margine, però, le strisce esposte richiedono generazione e disegno sincroni; cambio stanza, resize, variazioni di scala e revisione dei blocchi dei boss possono invalidare la bitmap. `drawTerrain` esegue più passaggi su celle, vicini, bordi e vegetazione.

**Sintomo probabile:** FPS medi buoni ma scatti attraversando nuovi biomi, ruotando il telefono o entrando in una nuova area. Il rischio cresce su CPU mobili lente e durante spostamenti rapidi; la classe hunter ha attualmente velocità 610 in `shared/config.ts`, utile come scenario di stress.

**Intervento proposto:** misurare separatamente cache hit, strisce e ricostruzione completa; precalcolare terreno/decorazioni in anticipo con lavoro limitato per frame. Valutare un worker solo dopo aver misurato costi e trasferimenti. Non spezzare in modo incoerente il terreno necessario a collisioni e gioco.

### G2 — Qualità fissa senza adattamento al tempo di frame, priorità alta sui dispositivi economici

**Dove:** `client/frame-budget.ts:2`, `client/main.ts:268`, `client/render.ts:375`, `client/render.ts:939`, `client/render.ts:1536`.

Il budget limita risoluzione e frequenza, ma non riduce automaticamente gli effetti quando il dispositivo non riesce a sostenere 60 FPS. Vignetta a pieno schermo, gradienti, ombre sfocate e trasparenze dei proiettili restano lavoro per frame. Il costo effettivo CPU/GPU dipende dal browser e va misurato.

**Dispositivi esposti:** Android economici, telefoni caldi dopo sessioni lunghe, tablet ad alta risoluzione, notebook in risparmio energetico e browser con accelerazione grafica inefficiente.

**Intervento proposto:** livelli qualità espliciti e adattamento con isteresi basato sui tempi di frame. Ridurre prima effetti cosmetici, ombre e risoluzione; conservare telegraph dei boss, nemici, salute e informazioni competitive. Offrire 30 FPS stabili come opzione. Non promettere 90/120/144 FPS: il limite attuale è 60 e non è un difetto di rete.

### G3 — Memoria grafica complessiva superiore al solo canvas, priorità medio-alta

**Dove:** `client/render.ts:55`, `client/render.ts:519`, `client/environment-art.ts:176`.

Tre milioni di pixel RGBA corrispondono a circa 11,4 MiB per una singola superficie a 4 byte/pixel. È una stima aritmetica, non una misura della memoria del browser. La bitmap del terreno aggiunge un margine di 192 unità per lato e può superare il budget del canvas visibile. Il tetto delle decorazioni di 8.388.608 pixel vale circa 32 MiB di pixel RGBA quando raggiunto. Si aggiungono sprite, immagini decodificate, superfici temporanee e compositing, con possibili copie interne.

**Sintomo probabile:** pressione di memoria o perdita del contesto nelle sessioni lunghe e con altre schede aperte. Questi limiti impediscono una crescita indefinita delle singole cache, ma non garantiscono un budget complessivo adatto a ogni telefono.

**Intervento proposto:** misurare anche memoria delle superfici, oltre allo heap JavaScript; assegnare budget più piccoli al profilo leggero. Verificare il ripristino di tutte le cache raster dopo perdita del contesto: il renderer invalida già il terreno, ma questo non dimostra il recupero di ogni canvas delle sprite e delle decorazioni.

### G4 — Allocazioni e interpolazione prima del culling grafico, priorità media/alta con folle

**Dove:** `client/snapshots.ts`, metodo `sample`; `client/prediction.ts:23`; `client/main.ts:271`; `client/render.ts:347`.

Ogni frame interpola e copia attori/proiettili ricevuti, poi il renderer filtra quelli visibili. Sono presenti array e oggetti temporanei, più Set e ordinamento degli attori visibili. Gli indici per snapshot sono già ottimizzati, ma il lavoro residuo cresce con la densità. I compagni lontani sono ricevuti intenzionalmente per gli indicatori di squadra.

**Sintomo probabile:** picchi di garbage collection e CPU durante battaglie affollate, soprattutto sui processori mobili. Non è prova di una perdita di memoria.

**Intervento proposto:** profiler delle allocazioni; riuso mirato delle strutture più costose e interpolazione completa solo quando necessaria, mantenendo dati sufficienti per indicatori e selezione. Verificare separatamente costo di parsing, interpolazione, combattimento e rendering.

### G5 — HUD, minimappa e timer sul thread principale, priorità media

**Dove:** `client/main.ts:145`, `client/main.ts:252`, `client/main.ts:307`; `client/ui.ts:491`, `client/ui.ts:561`; `client/render.ts:1631`; `client/style.css:931`.

L'HUD viene aggiornato a ogni snapshot; alcune scritture sono già deduplicate, altre modificano larghezze, altezze e testi. La minimappa visibile viene ridisegnata circa quattro volte al secondo. Il timer input si sveglia ogni 8 ms anche se la simulazione input è a 30 Hz; quando non si gioca ritorna subito, ma il timer esiste comunque. I pannelli `.glass` usano blur sullo sfondo; alcune regole mobili lo disattivano già.

**Sintomo probabile:** lavoro concorrente con rendering e parsing, consumo energetico, picchi di layout/compositing. Le chiamate a `getBoundingClientRect` meritano profiling quando precedute da scritture DOM; non implicano automaticamente un layout forzato in ogni caso.

**Intervento proposto:** deduplicare le scritture rimanenti, aggiornare solo pannelli visibili, cache del fondo minimappa, riduzione dei blur nel profilo leggero. Valutare il timer senza compromettere regolarità e latenza degli input.

### G6 — Costo iniziale di download e rasterizzazione, priorità alta su rete/mobile

**Dove:** `client/render.ts:14`, `client/render.ts:55`, `client/render.ts:212`; `client/ui.ts:8`; `server/index.ts:64`.

Il renderer prepara in parallelo tutte le sprite elencate al momento della costruzione, comprese quelle dei boss. Il disegno sui canvas è lavoro sincrono dopo il caricamento. Il download asincrono non elimina questo costo iniziale.

Dimensioni sorgente verificate: `boss_warden.svg` 1.131.730 byte, `wisp.svg` 1.054.664, `sentinel.svg` 1.043.387. I tre ritratti PNG referenziati dall'UI pesano complessivamente 5.230.253 byte, circa 4,99 MiB. Non significa che ogni immagine del repository sia scaricata all'avvio: vanno distinti riferimenti, effettivo utilizzo e cache del browser.

**Intervento proposto:** analizzare la waterfall a cache fredda, ottimizzare gli asset effettivamente richiesti, valutare formati raster compressi adatti e preparazione scaglionata. Mantenere fallback grafici e misurare il tempo fino al primo frame giocabile.

## Rischi di rete e server

### N1 — Snapshot completi JSON a 15 Hz, priorità alta e confermata dal microbenchmark

**Dove:** `server/simulation.ts:747` (`snapshotFor`), `server/index.ts:107`, `shared/config.ts:5`, `client/net.ts`, handler `onmessage`.

Ogni destinatario riceve copie complete degli attori nell'area di interesse, proiettili, pickup, trappole ed eventi. Il giocatore locale compare sia in `self` sia nell'array `actors`. Gli eventi restano nel buffer server fino a circa 1,8 secondi e possono essere ritrasmessi in snapshot successivi. Molti campi statici sono ripetuti.

Il raggio di interesse di 1.250 unità limita la distanza ma non la densità dei giocatori. Non è un filtro basato sul viewport: un telefono può ricevere molte entità fuori dalla sua porzione visibile. I compagni di squadra lontani sono inclusi per scelta funzionale.

**Effetti:** banda elevata, parsing frequente sul client, più allocazioni e serializzazione sul server. Lo scarto degli snapshot quando c'è coda contiene l'arretrato, ma non riduce la dimensione dello stato successivo.

**Intervento proposto:** separare dati statici/dinamici, quantizzare i numeri ove accettabile, valutare delta con baseline e risincronizzazione completa. Per gli eventi, sequenze/deduplicazione e recupero esplicito prima di smettere di ritrasmetterli. Un protocollo binario può ridurre overhead ma richiede misure e migrazione di versione. Non ridurre indiscriminatamente visibilità di avversari o informazioni necessarie al combattimento.

### N2 — Scansioni globali per destinatario e simulazione di aree disperse, priorità alta

**Dove:** `server/simulation.ts:747`, `server/simulation.ts:196`, `server/simulation.ts:644`, `shared/physics.ts:84`, `server/rooms.ts:160`.

`snapshotFor` scansiona giocatori/NPC e altre collezioni per ciascun destinatario, nonostante la simulazione abbia già celle spaziali per altre operazioni. La costruzione degli snapshot cresce approssimativamente con destinatari × entità da esaminare, oltre al payload serializzato.

Giocatori dispersi attivano più chunk e NPC: il codice limita i chunk attivi a 1.152 e gli NPC a 3.000, ma il costo prima di questi limiti è già significativo. Le collisioni usano bucket spaziali e tre passaggi: la concentrazione di molti attori nella stessa zona può aumentare fortemente le coppie locali. Tutte le stanze sono simulate in sequenza nello stesso processo.

**Intervento proposto:** riutilizzare indici spaziali anche per gli snapshot, indicizzare le altre entità e misurare scenari affollati e dispersi separatamente. Valutare isolamento delle stanze se le misure mostrano interferenza. I limiti di chunk/NPC non costituiscono una capacità di utenti certificata.

### N3 — Persistenza sincrona può sembrare lag di rete, priorità alta alla crescita degli account

**Dove:** `server/index.ts:290`, `server/store.ts:284`, `server/store.ts:293`.

Ogni cinque secondi il server esegue checkpoint e flush. Quando lo store è dirty, serializza tutti gli account e scrive/rinomina file con API sincrone sullo stesso thread che gestisce simulazione e socket. Anche `flushBosses` usa scritture sincrone; non va confuso con un flush necessariamente eseguito ogni cinque secondi.

**Sintomo probabile:** pause correlate ai salvataggi, più evidenti con molti account o disco lento; tutti i client possono percepirle insieme.

**Intervento proposto:** misurare durata/byte dei flush e ritardo dell'event loop; spostare la persistenza su una coda asincrona serializzata o worker preservando atomicità, ordine e gestione degli errori. Il benchmark qui eseguito non comprende persistenza.

### N4 — Code, perdita di pacchetti e riconnessione, priorità medio-alta

**Dove:** `server/index.ts:107`, `server/index.ts:127`, `client/net.ts` (`send`, `retry`, `onclose`); `client/main.ts:225`; `server/simulation.ts:190`.

Il server salta snapshot se `bufferedAmount > 0`; oltre 1 MiB nel percorso `send` chiude con codice 1008. Il client considera 1008 terminale e richiede di rientrare: una connessione troppo lenta può quindi finire senza riconnessione automatica. Il client rifiuta nuovi invii oltre 64.000 byte accodati; oltre 120 input pendenti smette temporaneamente di generarli. La coda server conserva fino a sei input, scartando il più vecchio.

Queste sono protezioni, ma su rete instabile possono produrre congelamenti/correzioni; un input di abilità scartato con la coda merita un test dedicato. La consegna ordinata del WebSocket comporta che dati nuovi possano attendere recuperi di trasporto precedenti; il solo scarto applicativo non elimina byte già in transito.

**Intervento proposto:** distinguere congestione transitoria da errore terminale, testare separatamente movimento e cast durante raffiche, misurare coda ed età dello stato. Non aumentare semplicemente le soglie: si rischia più latenza.

### N5 — Interpolazione e riconciliazione sotto jitter, priorità media

**Dove:** `client/snapshots.ts`, metodi `push` e `sample`; `client/prediction.ts:15`; `client/net.ts`, gestione `pong`.

A 15 Hz il ritardo base della presentazione remota è 100 ms e il tetto adattivo è 250 ms. Non coincide con il ping e non va sommato meccanicamente a ogni latenza osservata. Quando mancano snapshot la presentazione non estrapola oltre l'ultimo stato. Il movimento locale usa predizione, poi ricalcola gli input non confermati a ogni snapshot.

**Sintomo probabile:** avversari che si fermano e ripartono con FPS del canvas regolari; con molti input pendenti aumenta anche il lavoro CPU di riconciliazione. Il ping applicativo può includere ritardi del thread del browser/server, non soltanto il collegamento.

**Intervento proposto:** mostrare internamente età dell'ultimo snapshot, jitter, numero di input pendenti e grandezza delle correzioni. Tarare il buffer con prove riproducibili prima di abbassarne il ritardo.

### N6 — Distribuzione degli asset senza compressione nel server applicativo, priorità alta al primo accesso

**Dove:** `server/index.ts:64–73`, `server/index.ts:82`.

Il server di produzione invia file tramite stream e imposta cache immutable per gli asset, ma nel percorso esaminato non implementa gzip/Brotli né validazione ETag/Last-Modified. Un reverse proxy potrebbe aggiungerli: la configurazione di produzione effettiva non è stata verificata. I WebSocket hanno `perMessageDeflate: false` esplicito.

**Intervento proposto:** verificare gli header reali in produzione; compressione HTTP per JS/CSS/SVG e asset ottimizzati. Valutare la compressione WebSocket separatamente, perché aggiunge CPU/memoria e non sostituisce un protocollo meno ridondante. Non dedurre il traffico trasferito dalla sola dimensione gzip stampata da una build.

### N7 — Traffico e lavoro con scheda nascosta, priorità media

**Dove:** `client/main.ts:128`, `client/main.ts:197`, `server/index.ts:289`, `client/net.ts`, watchdog e heartbeat.

Il rendering si ferma in background, ma gli snapshot vengono ancora ricevuti, analizzati e passati all'HUD; lo stato sociale viene trasmesso ogni due secondi. È utile per continuità, ma mantiene consumo di rete/CPU. Sospensione del browser, cambio Wi-Fi/rete mobile e ripresa possono attivare timeout o riconnessioni.

**Intervento proposto:** profilare background/ripresa; valutare frequenza ridotta di dati cosmetici e HUD sospeso quando nascosto, conservando semantica del personaggio nel mondo, stato autorevole e risincronizzazione al ritorno.

## Misure locali del microbenchmark

Script: `scripts/benchmark-server.ts`. Per scenario: 360 tick, primi 60 esclusi dalle statistiche; input di movimento nulli, nessuna sessione WebSocket reale. Le dimensioni sono medie, i tempi sono p95 separati. I p95 di step e broadcast non si sommano per ottenere il p95 complessivo.

| Distribuzione | Giocatori | NPC | Step p95 ms | Broadcast JSON p95 ms | KiB/snapshot/client | MiB/s uscita teorica totale |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Vicini | 1 | 27 | 0,14 | 0,03 | 3,9 | 0,06 |
| Vicini | 16 | 42 | 0,29 | 0,64 | 11,8 | 2,76 |
| Vicini | 64 | 42 | 0,66 | 5,64 | 32,5 | 30,44 |
| Vicini | 128 | 42 | 1,23 | 18,92 | 60,0 | 112,53 |
| Dispersi | 1 | 48 | 0,30 | 0,05 | 8,5 | 0,12 |
| Dispersi | 16 | 359 | 1,57 | 0,86 | 9,6 | 2,26 |
| Dispersi | 64 | 1.345 | 7,12 | 6,63 | 11,1 | 10,45 |
| Dispersi | 128 | 2.658 | 17,77 | 22,27 | 12,6 | 23,71 |

Interpretazione:

- Con 128 giocatori vicini, 60 KiB × 15 equivale a circa 900 KiB/s per client, cioè 7,37 Mbit/s di solo JSON. Il totale stimato di 112,53 MiB/s corrisponde a circa 944 Mbit/s, prima degli overhead di trasporto e degli altri messaggi.
- Il traffico teorico deriva dalla serializzazione di ogni stato a 15 Hz: non è una misura della banda effettivamente sostenuta. Su reti lente lo scarto degli snapshot ridurrebbe il volume consegnato e la frequenza degli aggiornamenti.
- La distribuzione dispersa riduce il payload individuale ma aumenta NPC e costo della simulazione. Nel caso a 128 giocatori il broadcast occupa già circa 22 ms p95; il budget nominale di un tick è 33,3 ms e il carico reale comprende anche altre attività.
- Il test non copre combattimento intenso, salvataggi, autenticazioni simultanee, TLS, ritrasmissioni e browser. I valori non giustificano una dichiarazione come «supporta 128 giocatori».

## Impatto sulle principali classi di dispositivi

| Classe | Rischi prevalenti | Verifica necessaria |
| --- | --- | --- |
| Smartphone Android economico | CPU/GC, generazione terreno, memoria, riscaldamento, rete variabile | Profilo leggero, sessione reale di 20–30 minuti, navigazione e combattimento |
| Smartphone Android potente | Thermal throttling, effetti, parsing di folle; pannello 120 Hz limitato dal gioco a 60 | Confronto primi minuti/fine sessione e risparmio energetico |
| iPhone, modelli meno recenti e recenti | Pressione di memoria, costo Canvas del browser, sospensione/ripresa e rotazione | Safari su hardware fisico, ritorno da background e rete mobile |
| Tablet Android/iPad | Superfici più grandi, cache terreno e memoria grafica | Portrait/landscape, split screen ove disponibile, lunghe sessioni |
| Notebook con GPU integrata/Chromebook | Banda di memoria, CPU condivisa con altre schede, modalità batteria | Alimentazione/batteria, GPU attiva e altre schede aperte |
| Desktop con GPU dedicata | CPU del thread principale, parsing JSON e congestione server | Folla/combattimento; non fermarsi ai soli tempi GPU |
| Monitor 4K/ultrawide e Retina | Riduzione DPR per rispettare il budget; cache/compositing restano un costo | Risoluzioni diverse, zoom browser e cambio monitor; controllare anche nitidezza |
| Monitor 90/120/144/165 Hz | Cadenza percepita diversa con rendering limitato a 60 | Frame pacing, non solo contatore FPS medio |
| Browser senza accelerazione efficiente, macchine virtuali o desktop remoto | Canvas/compositing software o trasporto video esterno | Misurazione separata; non confondere il flusso video remoto con il WebSocket del gioco |

Questa tabella descrive esposizione ai rischi, non incompatibilità accertate. Un'emulazione mobile desktop verifica layout/input, ma non riproduce GPU, memoria e comportamento termico del telefono.

## Piano di verifica e ordine degli interventi

1. **Telemetria prima delle modifiche:** tempi frame p50/p95/p99, pause oltre 50 ms, cache miss terreno, parsing JSON, riconciliazione, byte/s per client, età snapshot, code e ritardo event loop. `server/metrics.ts` contiene già step/snapshot p95 e contatori: aggiungere finestre temporali e costo dell'intero broadcast. La media byte/s attuale è dall'avvio e può nascondere picchi.
2. **Riduzione del payload e query spaziali:** affrontano il rischio più evidente nelle misure. Validare protocollo, ingresso/uscita dall'interesse, compagni lontani, baseline perdute, cambio stanza e riconnessione.
3. **Persistenza fuori dal percorso bloccante:** testare con una base account grande e disco lento, senza sacrificare affidabilità dei salvataggi.
4. **Profilo grafico leggero e caricamento asset:** misurare su almeno un telefono economico reale, poi separare i picchi del terreno dal costo continuo degli effetti.
5. **Sessioni end-to-end:** prove di almeno 20–30 minuti con esplorazione, teletrasporto/cambio stanza, arena, boss, molti proiettili, minimappa aperta, rotazione e ritorno da background.

Matrice di rete proposta: connessione locale stabile; Wi-Fi con RTT 30–80 ms; rete mobile con RTT 80–150 ms e jitter; scenario degradato con RTT 200–300 ms, jitter 50–100 ms e perdita 1–3%; download limitato a 2/5/10 Mbit/s e upload limitato separatamente. Sono condizioni di prova, non misure o valori universali delle reti. La sola limitazione della velocità di download non riproduce tutti i problemi del trasporto WebSocket.

Obiettivi iniziali da validare: cadenza vicina a 16,7 ms per il profilo 60 FPS o 33,3 ms per quello 30 FPS; assenza di pause frequenti oltre 50 ms; code e memoria che tornano al livello atteso dopo una scena pesante. Conservare margine sul budget server di 33,3 ms includendo broadcast e altri task. Definire una capacità supportata solo dopo prove con socket, rete, persistenza e dispositivi reali.

## Diagnosi rapida dei sintomi

| Sintomo | Primo controllo |
| --- | --- |
| Scatta anche il paesaggio, ping stabile | Tempo frame, cache miss terreno, GPU/compositing, GC |
| Paesaggio fluido ma nemici fermi/a scatti | Età snapshot, jitter, snapshot saltati e coda socket |
| Scatti contemporanei per tutti | Tick/broadcast server, flush dello store, event loop |
| Peggioramento dopo molti minuti sul telefono | Temperatura, memoria grafica e risparmio energetico |
| Avvio lento, partita poi fluida | Asset richiesti, compressione HTTP, decodifica e rasterizzazione |
| Teletrasporti/correzioni locali sotto rete lenta | Input pendenti/scartati, riconciliazione e ripresa della connessione |

La priorità più solida emersa è la riduzione del costo degli snapshot. Sul lato grafico servono misure fisiche per stabilire se, per ciascuna classe di dispositivo, prevalgano generazione del terreno, effetti, memoria o lavoro JavaScript.
