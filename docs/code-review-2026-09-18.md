# Review completa — 18 settembre 2026

## Valutazione

La struttura è una buona base per un prototipo su singolo processo: server autorevole, fisica condivisa, input sequenziali con ACK, riconciliazione, interesse spaziale, room con epoch, cap e cache limitate. Non è ancora una capacità certificata per 128 giocatori né un sistema competitivo con compensazione della latenza. L'assenza di database è una scelta accettata, non un difetto da risolvere prima dell'editor.

Sono stati esaminati trasporto, autenticazione/persistenza, simulazione e combattimento, room/arena, boss e dungeon, generazione/fisica, input mobile, predizione/interpolazione, renderer/audio/UI, build/deployment e test. La review è statica più test e benchmark locali: non include un audit infrastrutturale, un test di intrusione completo o misure su telefoni fisici.

## Problemi corretti

| Priorità | Riscontro | Modifica |
| --- | --- | --- |
| P1 | `client/main.ts` aggiungeva 50 ms di ritardo fisso al corpo locale dopo l'interpolazione. Vicino a qualsiasi attore vivo, `contactPresentation` lo spostava sulla timeline remota di 150–300 ms. La reattività variava proprio in combattimento. | Eliminati entrambi i passaggi. Rimangono predizione, interpolazione tra tick e correzioni autorevoli. La presentazione locale non cambia timeline avvicinandosi agli NPC. |
| P1 | La firma JWT veniva confrontata per lunghezza della stringa prima di `timingSafeEqual` sui byte. Una firma non ASCII di 43 caratteri produceva buffer di lunghezza diversa, con eccezione non gestita in `/api/lobby`. | Confronto delle lunghezze dei buffer; JWT scaduto anche esattamente a `exp`. Test unitario e HTTP con firma malformata. |
| P1 | `scryptSync` nel callback WebSocket bloccava tutti i tick durante login/registrazione; il budget per socket non impediva nuovi tentativi aprendo connessioni. | Trasporto su scrypt asincrono, massimo 4 derivazioni attive, burst di 8 tentativi/IP e recupero di un tentativo ogni 7,5 s; cache del budget limitata. Nessuna coda di hash illimitata. Registrazioni concorrenti ricontrollano l'unicità dopo l'attesa. |
| P1 | Dopo il primo `welcome`, `GameConnection` manteneva modalità register e password. Una riconnessione tentava di registrare nuovamente lo stesso nome e falliva. | La richiesta diventa una ripresa tramite JWT; eliminate le credenziali dalla richiesta mantenuta in memoria. La room viene invalidata quando si ritira il socket. |
| P2 | Tick di recupero potevano inviare più snapshot obsoleti nello stesso callback. Le code potevano accumulare 256 KiB prima di saltare un aggiornamento, dopo averlo già costruito. | Una sola pubblicazione del più recente stato per callback; socket con dati accodati saltano la costruzione dello snapshot. I messaggi di controllo mantengono il canale affidabile. |
| P2 | 10 Hz e buffer minimo fisso di 150 ms allungavano la visibilità di attacchi e avversari. | Snapshot a 15 Hz, minimo del buffer legato all'intervallo: 100 ms, espandibile fino a 250 ms con jitter. Corretto anche il confronto del playhead col target per non anticiparlo a rete stabile. Protocollo aggiornato a 6. |
| P2 | Il joystick saltava da zero a circa il 20% della velocità appena oltre gli 8 px di dead zone. | Rimappatura continua del tratto attivo fino alla velocità massima; test della soglia e delle diagonali. |
| P2 | `/health` esponeva soltanto il costo dell'ultimo callback, spesso senza alcun tick. | Aggiunte finestre limitate di p95/massimo per step e snapshot, byte serializzati, snapshot inviati/saltati e tick di recupero. |
| P2 | Documentazione di account e frequenze non corrispondente al codice. | README aggiornati per JWT, password, 30/15 Hz, assenza voluta di DB e limiti correnti. |

La rimozione del ritardo vicino agli attori privilegia la risposta del controllo: il contatto visivo con corpi remoti può ancora divergere finché arriva la correzione del server. Non è stata inventata una collisione locale contro posizioni remote vecchie.

## Frequenze e latenza

| Flusso | Prima | Adesso | Significato |
| --- | --- | --- | --- |
| Simulazione autorevole | 30 Hz | 30 Hz | Un passo ogni 33,3 ms |
| Generazione/invio input | 30 Hz | 30 Hz | Comandi di durata fissa; niente tempo extra scelto dal client |
| Snapshot server → client | 10 Hz | 15 Hz | Stato ogni 66,7 ms invece di 100 ms |
| Rendering | requestAnimationFrame | requestAnimationFrame | Può seguire 60/120 Hz del display senza aumentare il tick server |
| Buffer remoto | 150–300 ms | 100–250 ms | Ritardo rispetto agli arrivi, adattato al jitter |
| Ritardo locale esplicito | 50 ms, più cambio timeline ai contatti | Rimosso | Rimane l'interpolazione locale fino a un tick |

**30 ms di ping non equivalgono a 30 ms input-to-photon.** Vanno considerati campionamento input, passo server, cadenza snapshot, buffering e frame. La predizione rende il movimento locale indipendente dall'attesa della risposta; gli attacchi e i loro risultati restano autorevoli e ancora non hanno predizione cosmetica completa.

Non portare automaticamente tutto a 60 Hz. La simulazione a 60 Hz raddoppia la frequenza della logica per risparmiare al massimo 16,7 ms di quantizzazione del tick. Snapshot a 60 Hz moltiplicherebbero per quattro il traffico attuale. Il compromesso scelto 30/15 è adatto alla fase attuale e richiede il confronto su dispositivi reali; 30/20 richiederebbe inoltre uno scheduler indipendente, perché il modulo attuale presuppone un rapporto intero tra tick e snapshot.

L'interpolazione scambia un buffer temporale per continuità visiva; aumentare il send rate senza ridurre il payload non risolve la capacità. Riferimento primario: [Glenn Fiedler, Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/). La compressione WebSocket non è stata abilitata alla cieca: [ws documenta costi di CPU e memoria](https://github.com/websockets/ws#websocket-compression). Per la derivazione asincrona delle password: [Node.js, crypto.scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).

## Misure riproducibili

`npm run benchmark:server`: 360 tick per scenario, primi 60 esclusi, 300 misurati. Simulazione in memoria con costruzione e serializzazione JSON di tutti gli snapshot; giocatori fermi, NPC attivi. Nessun socket, TLS, client o scrittura di account nel benchmark. Esecuzione locale Node 22.13.0; risultati variabili con macchina e carico.

| Scenario | Giocatori | NPC | Step p95 ms | Intero broadcast p95 ms | KiB/snapshot/client | MiB/s totali stimati a 15 Hz |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Concentrati | 1 | 21 | 0,17 | 0,03 | 3,8 | 0,06 |
| Concentrati | 16 | 42 | 0,23 | 0,66 | 12,2 | 2,86 |
| Concentrati | 64 | 42 | 0,52 | 6,18 | 32,8 | 30,75 |
| Concentrati | 128 | 42 | 0,84 | 21,19 | 60,4 | 113,18 |
| Distribuiti | 16 | 369 | 1,45 | 0,78 | 8,8 | 2,05 |
| Distribuiti | 64 | 1.357 | 7,21 | 5,92 | 8,8 | 8,28 |
| Distribuiti | 128 | 2.672 | 17,87 | 20,23 | 9,6 | 17,98 |

La folla è dominata da serializzazione e banda: 113 MiB/s è vicino a un gigabit/s di soli payload JSON, prima dell'overhead. Con giocatori distribuiti cresce il costo NPC; step e broadcast nello stesso callback possono superare i 33,3 ms. Queste misure non certificano nemmeno i casi inferiori su un server pubblico: indicano dove intervenire. Il passaggio 10→15 Hz aumenta del 50% il traffico a parità di scena; le ottimizzazioni delle code evitano accumuli, non riducono questo costo nominale.

`npm run test:review`: server su porte isolate, account temporanei, browser headless e chiusura in `finally`. La prova mobile introduce 15 ms per direzione nel WebSocket e usa input touch reali via CDP. Nella versione finale: inizio movimento a 59,4 ms dal comando di prova, 26 frame utili, zero frame fermi durante il movimento e passo massimo 3,18 unità. Questa misura riguarda il corpo locale su desktop con viewport mobile, non un telefono fisico o l'input-to-photon della GPU.

Esito finale: **140 test unitari passati, 2 test di integrazione passati, TypeScript/build superati, diff senza errori di whitespace**. Sono verificati anche handshake room, cambio sessione duplicata, riconnessione, logout, JWT malformato HTTP, editor desktop/mobile, paint, undo/redo, export di livelli NPC, persistenza locale e import invalido. La suite unitaria copre fisica, arena, boss, social, input, snapshot (jitter a 10 e 15 Hz), autenticazione e progetto dungeon. I test Playwright legacy in `tests/e2e` non sono stati dichiarati tutti verdi: alcuni usano ancora il vecchio ingresso senza password e selettori HUD rimossi.

## Priorità rimaste

1. **P1 — Snapshot più piccoli prima di aumentare giocatori o Hz.** In `WorldSimulation.snapshotFor`, ogni destinatario riceve a ogni invio attori completi, incluse molte proprietà statiche, e `self` viene duplicato nella lista. Separare spawn/metadati da stato dinamico, quantizzare coordinate, introdurre delta/keyframe con reset per room e riconnessione; misurare risparmio e costi. Non nascondere avversari rilevanti per ottenere numeri migliori.
2. **P1 — Persistenza JSON fuori dal percorso del tick.** `AccountStore.flush` usa stringify/write/rename sincroni; `BossEncounter.save` li chiama anche per loot e cambi incontro. Implementare una singola coda asincrona ordinata, batching, propagazione degli errori e drain allo shutdown, mantenendo le garanzie su account/ricompense. Non richiede introdurre un database.
3. **P1 — Input arretrati e rete mobile instabile.** La coda server conserva sei comandi: può aggiungere fino a circa 200 ms quando si riempie. Oltre il limite vengono scartati anche eventuali cast. Misurare queue age, input→ACK e correzioni; progettare scadenza del movimento e gestione separata degli eventi cast senza concedere tempo extra agli speedhack. Non basta consumare più comandi nello stesso tick.
4. **P2 — Attacchi e contatti.** Aggiungere feedback cosmetico immediato del cast locale e conferma/cancellazione autorevole; allineare effetti remoti e telegraph alla presentazione senza alterare le scadenze dei danni. Per il PvP valutare rewind limitato e validato, con test degli angoli e degli ostacoli. L'auto-aim sceglie oggi sul presente del server mentre gli avversari sono visti nel passato.
5. **P2 — Telemetria su telefoni veri.** Frame time p50/p95/p99, long task, input-to-photon, correzioni per secondo, buffer socket e rete con jitter/stalli TCP. Provare Android medio e Safari iOS a DPR diversi. La camera mantiene uno smoothing di circa 95 ms: è una scelta visiva da confrontare con una modalità più stretta, non la latenza del socket.
6. **P2 — CPU con esplorazione distribuita.** Gli snapshot scandiscono tutte le entità prima del filtro; gli NPC eseguono acquisizione target/linea di vista a ogni tick. Riutilizzare un indice spaziale di snapshot che includa anche cadaveri, mantenere i compagni lontani e separare frequenza AI dal movimento; benchmark di combattimento, boss e proiettili.
7. **P2 — Account e operatività.** Revoca dei token, recupero credenziali, backup verificato e validazione più stretta del JSON. Il reset storico del formato v1 è distruttivo e va reso esplicito/protetto prima di importare vecchi dati. `/api/lobby` ordina tutti gli account per ogni richiesta: aggiungere cache del leaderboard e limiti HTTP prima di esposizione significativa.
8. **P2 — Test e manutenzione.** Aggiornare gli e2e legacy, isolare anche il loro `DATA_FILE` (il config Playwright corrente può riutilizzare la porta 3000 e scrivere account di test nell'archivio abituale). Inserire in CI unitari/build e test di integrazione isolati. Mantenere segreti e dati fuori dalle route Vite/artefatti.

## Decisione sul dungeon maker

Procedere è ragionevole perché esiste già un catalogo spaziale condiviso: è stata implementata una prima versione di authoring utilizzabile, descritta in [dungeon-maker.md](dungeon-maker.md). Il runtime ora consuma anche terreno per singola tile e spawn NPC espliciti; il catalogo NPC usato dalla palette è lo stesso della simulazione.

L'editor include boss futuri come segnaposto, senza richiedere che il comportamento esista. Salva/esporta bozze e compila le definizioni della mappa, ma non attiva automaticamente dungeon nel server pubblico. L'estensione successiva aggiunge incontri rettangolari indipendenti o con boss multipli, fiamme configurabili, ricompense differite fino al completamento, reset del gruppo al wipe e un comando di installazione delle bozze nel catalogo condiviso. Restano poligoni distinti per le regole del fight, una libreria di progetti, migrazione dei dungeon installati e playtest con AI/combattimento nell'editor.

## Chiarimento sul ritardo intenzionale

Il ritardo di presentazione aveva un obiettivo legittimo: avvicinare l'immagine locale alla conferma del server. La rimozione rende il movimento più reattivo, ma non risolve da sola il disallineamento degli attacchi e può renderlo più evidente. In `client/main.ts` il corpo locale è predetto mentre anche i proiettili del giocatore provengono dalla timeline interpolata remota; gli eventi cast mantengono la posizione autorevole precedente. Un offset fisso non può adattarsi a ping, jitter e code variabili. Il prossimo intervento prioritario per il feel è la predizione cosmetica dei cast con identificatore input/cast, conferma e correzione autorevole, senza anticipare i danni. Questo era lo stato al momento della review. L'intervento successivo implementa predizione cosmetica dei cast melee/proiettile e correlazione tramite inputSeq: vedi l'aggiornamento qui sotto.

15 Hz indica invii di stato ogni 66,7 ms, non frame disegnati. È un compromesso rispetto ai precedenti 10 Hz: campioni più frequenti e +50% traffico nominale. La simulazione resta a 30 Hz, il rendering segue il display. Il limite a 30 FPS può essere un'opzione per consumi o frame pacing su dispositivi lenti, ma non sincronizza automaticamente rete e combattimento.

## Aggiornamento: origine visiva degli attacchi

Il client mostra il lancio sulla posizione effettivamente renderizzata del giocatore, prima della risposta. Gli eventi e i proiettili autorevoli dei cast standard riportano inputSeq, derivato dal comando consumato sul server. Il client sostituisce il feedback speculativo senza duplicarlo; rifiuti, cooldown, risorse, impatti già avvenuti e cambio room vengono gestiti senza modificare danni o hitbox. Il melee segue il corpo, mentre proiettili, impatti e aree a terra restano nello spazio del mondo. I proiettili locali usano correzione morbida ed estrapolazione limitata a 100 ms con sweep contro i muri, separatamente dall'interpolazione remota. Auto-aim predetto è indicativo: il server mantiene la scelta finale. Le abilità speciali (dash, trappole, aree e raffica hunter) non hanno simulazione anticipata dei loro effetti di gameplay.

Test browser con server/account isolati a RTT emulato 30/150/300 ms: distanza iniziale proiettile-personaggio 0 unità, prima comparsa circa 28–34 ms dal comando, nessun duplicato per sequenza input. Non è una misura input-to-photon su telefono fisico. Test unitari coprono anche cast rifiutati, cooldown/risorse, muri, direzione corretta dal server, morte e reset. Il protocollo passa a 7: distribuire client e server insieme.

Nel workspace la velocità del mago è stata portata dall'utente a 500, mentre il dardo base resta a 480: è quindi possibile superare il proprio proiettile dopo un lancio correttamente allineato. Questi valori non sono stati modificati dalla correzione visiva.

Verifica finale dell’intervento: 156 test unitari, 3 integrazioni browser/trasporto e build superati. Nel test di attacco mantenuto tutti e tre i profili RTT producono 3 colpi nello stesso intervallo di input, tutti confermati dal server. Il client misura il ping subito dopo il welcome e stima l’arrivo del comando per rispettare il cooldown senza moltiplicare i tentativi per ogni tick di movimento. I test dungeon sono stati adattati alla presenza di contenuti personalizzati, senza cambiare il catalogo installato o gli account.
