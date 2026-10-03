# Review del progetto — 3 ottobre 2026

## Priorità aggiornate dopo il confronto

Le priorità iniziali sotto sono una fotografia della review, non il piano di lavoro concordato. Il proprietario del progetto ha chiarito che coordinate dei test storici, percorsi dungeon sull'acqua e persistenza del gold sono accettabili nella fase corrente e vanno rinviati. Il lavoro utile adesso riguarda costo degli snapshot e qualità dei confini fra moduli.

Sequenza tecnica consigliata:

1. Separare tipi dello stato autorevole, dati del protocollo e viste client. Gli oggetti `Actor` attuali vengono usati per simulazione, snapshot e corpo persistito; questa condivisione propaga campi nuovi su più livelli.
2. Estrarre selezione delle entità e costruzione degli snapshot dalla simulazione, mantenendo inizialmente lo stesso protocollo e le stesse regole di visibilità.
3. Introdurre proiezioni esplicite per giocatore locale e attori remoti, metadati trasmessi quando cambiano e aggiornamenti privati su revisione. La narrativa usa già aggiornamenti per revisione, mentre l'inventario viene clonato a ogni snapshot.
4. Ricostruire snapshot completi lato client prima di alimentare riconciliazione/interpolazione; gestire ingresso/uscita dall'interesse e reset su room/epoch/riconnessione. Aggiornare la baseline server soltanto per messaggi effettivamente inviati.
5. Indicizzare la selezione degli snapshot includendo cadaveri ed eccezioni per compagni lontani. L'indice di combattimento non va riusato automaticamente se omette entità ancora visibili.
6. Misurare di nuovo CPU e payload prima di decidere delta per campo, quantizzazione o formato binario. In una folla tutta visibile, un indice non elimina il volume di dati per destinatario.
7. Separare gradualmente renderer e UI in componenti con responsabilità proprie; estrarre i sistemi della simulazione quando vengono toccati, senza introdurre un ECS generale.
8. Portare i salvataggi dietro un'interfaccia e una coda ordinata. Le scritture sincrone sono un costo runtime distinto dal problema della dimensione dei moduli; spostare solo l'I/O ad asincrono non elimina il costo di stringify né le garanzie da definire.

Per queste modifiche servono verifiche dedicate a sincronizzazione, visibilità, transizioni di stanza e comportamento preservato; il riallineamento di tutta la vecchia suite alla mappa personale resta fuori dalle priorità correnti.

Implementazione successiva: proiezioni esplicite, builder con indici dedicati, delta/keyframe e ricostruzione client sono ora presenti nel protocollo 9. Sono stati estratti anche minimappa, rasterizzazione sprite e risorse grafiche UI. Risultati, verifiche e limiti residui sono riportati in [snapshot-replication.md](snapshot-replication.md); i rilievi e benchmark sotto restano la fotografia precedente all'intervento.

## Valutazione e decisione proposta

Riftlands ha una base tecnica valida per un gioco multiplayer in evoluzione: autorità server, regole condivise, predizione client, istanze separate, authoring con validazione, cache limitate e test estesi. Il problema principale è il disallineamento fra contenuti modificabili, test e alcuni presupposti storici. Non serve riscrivere il progetto.

Ordine consigliato:

1. Stabilizzazione breve: test indipendenti dalla mappa personale, verifica accessi ai dungeon e affidabilità delle ricompense.
2. Completare una modalità arena piccola e ripetibile: ingresso, preparazione, combattimento, esito e rivincita volontaria; poi ingresso per gruppi 2v2.
3. Aggiungere un secondo NPC con una funzione concreta, consolidando solo le definizioni che servono davvero.
4. Creare un solo edificio visitabile e utile, come una bottega o locanda.
5. Realizzare un BG con un unico obiettivo e numero ridotto di partecipanti, dopo verifica del combattimento di gruppo.
6. Separare fisicamente il mondo per regioni quando dimensioni, caricamento iniziale o collaborazione sui contenuti lo richiedono. Prima intervenire sui colli di bottiglia misurati.

Se la priorità di prodotto è un RPG di esplorazione anziché il PvP, invertire arena ed edificio/NPC. Il codice non determina quale pubblico si vuole servire; a parità di obiettivo, l'arena offre oggi il percorso più breve per validare il multiplayer già implementato.

## Verifiche eseguite e limiti

- `npm run build`: TypeScript strict e build Vite superati; avviso per un bundle condiviso sopra 500 kB.
- `npm test`: 229 test, 212 superati e 17 falliti, esito confermato con log completo.
- `scripts/benchmark-server.ts`: otto scenari in memoria, risultati sotto.
- Diagnostica temporanea: arena sulle coordinate effettive del documento e collisioni lungo i percorsi dichiarati dei dungeon.
- Lettura di client, simulazione, stanze, persistenza, NPC, narrativa, world/dungeon authoring e test.
- Nessun dev server avviato. Non eseguiti test browser, misure su telefono, prove di rete reali o audit completo di sicurezza. La review non certifica ogni percorso del codice.
- I file preesistenti non tracciati `client/rock-art.ts` e `tests/rock-art.test.ts` sono stati preservati.

## Riscontri da affrontare

### 1. Test dipendenti dai contenuti del mondo — priorità alta

I test importano frequentemente il documento corrente attraverso i valori predefiniti di `World` e `WorldSimulation`. Il mondo attuale ha spawn a celle `(10,115)` e ingresso arena a `(-18,114)`. Numerosi test presumono ancora spawn e zona sicura intorno all'origine e countdown di un secondo; il countdown configurato è tre secondi.

Sei fallimenti sono in `tests/arena-gate.test.ts`: l'helper usa una X vicina a zero, ignorando la X effettiva dell'ingresso. Con due giocatori sulle coordinate attuali, una verifica in memoria crea regolarmente un'istanza arena dopo il countdown. Questi fallimenti non dimostrano che l'arena attuale sia rotta.

Altri fallimenti riguardano cinque test outpost, un test di presentazione del combattimento, un test di collocazione dungeon, un test sullo scaricamento NPC, due test world/physics e una migrazione account. Quest'ultima confronta un JSON precedente all'introduzione dei campi inventario/narrativa, che il caricamento ora inizializza.

Intervento: introdurre fixture sintetiche per regole, geometria e zone; permettere al RoomManager di ricevere l'ambiente di prova, come già avviene nella simulazione. Separare i test del motore dai controlli di qualità dei contenuti installati. Non indebolire le asserzioni solo per ottenere una suite verde.

### 2. Percorsi dungeon dichiarati con collisioni — priorità alta per contenuti e contratto

Il test `world-physics` fallisce anche sui percorsi effettivi. Campionando 101 punti per percorso e usando raggio 15:

| Dungeon | Punti bloccati | Primo punto bloccato | Terreno |
| --- | ---: | --- | --- |
| Cathedral Cave | 29 | `(3672,5016)` | acqua |
| Northpost Ruins | 99 | `(3048,3144)` | acqua |

In `shared/world.ts`, `generateTile` applica terreno dungeon e override manuali prima del percorso `onDungeonApproach`. Un percorso dichiarato può quindi risultare coperto da acqua o altri ostacoli. Questo dimostra che il percorso campionato non è sempre percorribile; non dimostra che tutti gli accessi reali al dungeon siano impossibili.

Intervento: decidere se `approach` resta una garanzia del motore oppure diventa un'indicazione che il maker deve validare. Aggiungere controlli di raggiungibilità da ingresso a punti di attivazione e spawn, includendo raggio del personaggio, asset solidi e stato dei passaggi. Se il campo è ormai superato dall'authoring manuale, eliminarne gradualmente dipendenze e aspettative invece di mantenerlo ambiguo.

### 3. Ricompense distribuite su due file senza transazione — priorità alta

`server/boss-encounter.ts`, metodo `collect`, accredita gold e rimuove il drop in memoria, poi chiama `store.flush()` per gli account e `save()` per i boss. La seconda operazione scrive `dungeon.json` separatamente.

Se il processo termina dopo il primo salvataggio e prima del secondo, al riavvio possono risultare sia il gold già accreditato sia il drop ancora disponibile. L'atomicità della sostituzione di ciascun file non rende atomica la coppia. È una finestra identificata dalla sequenza del codice; non è stato simulato un crash in questa review.

Intervento: identificativi di ricompensa con riscossione idempotente e recupero verificabile, oppure un journal transazionale per gli aggiornamenti correlati. Una semplice conversione delle scritture ad asincrone non risolve questo problema. Non è obbligatorio introdurre subito un database.

### 4. Snapshot completi e scansioni globali — priorità alta prima di folle/BG

`server/simulation.ts:796`, `snapshotFor`, esamina tutte le collezioni per destinatario e copia gli attori completi, incluso `self` sia separatamente sia dentro `actors`. L'inventario viene clonato a ogni snapshot; molti campi statici sono ripetuti. Esistono già filtri di interesse, ma la densità resta determinante.

Intervento progressivo: indice spaziale per snapshot; invio dei dati privati quando cambiano; separazione dei metadati statici dallo stato dinamico; poi delta/keyframe e quantizzazione con reset per ingresso stanza e riconnessione. Conservare tutte le informazioni competitive necessarie.

### 5. Persistenza sincrona sul processo della simulazione — priorità crescente

`AccountStore.flush` e `flushBosses` usano stringify, write e rename sincroni. Il salvataggio periodico e alcune transazioni di gioco condividono l'event loop con tick e broadcast.

Intervento: singola coda di salvataggio ordinata, batching, gestione degli errori e drain allo shutdown. Prima definire le garanzie delle ricompense correlate. L'impatto attuale su disco non è stato misurato dal benchmark in memoria.

### 6. Moduli grandi, residui e documentazione — priorità media

`client/render.ts` ha circa 2.004 righe, `client/ui.ts` 1.075, `server/simulation.ts` 952, `client/environment-art.ts` 928. La dimensione non è di per sé un bug, ma rende costose le modifiche che incrociano più sistemi.

Separazioni utili: rendering terreno/attori/effetti/minimappa; lobby e pannelli HUD; combattimento e attivazione chunk. Conservare un orchestratore centrale e contratti piccoli, senza introdurre un framework generico per ogni funzione.

Non risultano riferimenti al modulo `client/render_old.ts` nelle ricerche effettuate: è una copia di circa 2.127 righe, candidata alla rimozione dopo verifica dell'uso esterno. La cronologia Git dovrebbe conservare le versioni precedenti. Il file `q` contiene un vecchio elenco Git, candidato alla pulizia. I backup JSON hanno uno scopo di recupero e sono ignorati da Git: definirne la conservazione, non eliminarli indiscriminatamente.

README e note storiche non coincidono ovunque con il codice: il protocollo attuale è 8, le classi sono quattro, lo spawn è stato spostato e il DPR massimo effettivo è 1,5. Le review precedenti restano utili come storico, ma non devono sostituire i dati correnti.

## Benchmark corrente

Node 22.13.0, macchina locale, 360 tick per scenario e 60 di riscaldamento. Giocatori fermi, NPC attivi, costruzione e serializzazione snapshot. Nessun socket, TLS, rendering client o salvataggio su disco. Le cifre di banda sono stime dal payload e dalla frequenza di 15 Hz.

| Scenario | Giocatori | NPC | Step p95 ms | Broadcast p95 ms | KiB/snapshot/client | MiB/s stimati |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Concentrati | 1 | 8 | 0,06 | 0,02 | 1,6 | 0,02 |
| Concentrati | 16 | 8 | 0,15 | 0,53 | 8,0 | 1,88 |
| Concentrati | 64 | 8 | 0,53 | 4,99 | 28,5 | 26,73 |
| Concentrati | 128 | 8 | 1,07 | 18,09 | 55,9 | 104,79 |
| Distribuiti | 1 | 9 | 0,04 | 0,02 | 2,1 | 0,03 |
| Distribuiti | 16 | 75 | 0,63 | 0,58 | 3,3 | 0,78 |
| Distribuiti | 64 | 1.039 | 6,64 | 6,40 | 10,1 | 9,44 |
| Distribuiti | 128 | 2.368 | 21,20 | 25,51 | 13,0 | 24,37 |

Un tick dispone di circa 33,3 ms. Nel caso distribuito da 128 giocatori, le due fasi hanno p95 individuali di 21,2 e 25,51 ms: non sommare i percentili come se fossero una misura del callback completo, ma il margine è chiaramente insufficiente per trattare 128 come capacità certificata. Tutte le stanze sono simulate in sequenza nello stesso processo: aprire istanze non elimina il carico CPU condiviso.

## Confronto delle opzioni

### NPC

L'infrastruttura esistente basta per un secondo personaggio simile a Nereo. Non costruire ora un editor completo per narrativa, scripting arbitrario o un sistema universale di AI.

Prima di aggiungere più oggetti/missioni, sistemare vincoli concreti: inventario iniziale da un solo slot; dialoghi obbligatoriamente collegati a una quest; quest con un solo obiettivo di consegna; loot condizionato dal contenuto; tipi di attacco ostili con ramificazioni specifiche per `wisp`. Rendere configurabili solo gli aspetti richiesti dal nuovo personaggio e validare i riferimenti NPC → dialogo → quest → item.

Un NPC utile chiude un ciclo di gioco: dà una ragione per esplorare, spendere ricompense o tornare. Un'altra variante senza nuova funzione aggiunge soprattutto contenuti e manutenzione.

### Arena e BG

La base delle istanze è già presente: trasferimenti, account temporanei, epoch per scartare input di stanze precedenti, ritorno al mondo e regole arena/BG differenti. `createMatch` ammette arena fino a 3v3 e BG fino a 5v5, ma l'accesso di gioco implementato è 1v1.

L'arena ha una mappa specchiata con pilastri, eliminazione e scadenza. Migliorare prima preparazione, leggibilità, risultato, rivincita volontaria e ingresso 2v2. Usarla per verificare le quattro classi e combattimento di gruppo; evitare subito ranked, stagioni e matchmaking elaborato.

Il BG attuale è una base tecnica con squadre, respawn e mappa quadrata. Mancano obiettivi, punteggi, vittoria per obiettivo e accesso dedicato. Un singolo punto da controllare, con gruppi piccoli, è una prima estensione ragionevole. BG grandi amplificano rete, effetti, bilanciamento e il problema di avere abbastanza giocatori contemporanei.

### Edifici visitabili

Distinguere tetto che scompare e interni sulla stessa mappa da interni in un altro spazio. Il primo percorso riusa celle bloccate e visibilità/fade già presenti negli asset. Il secondo richiede portali, identità della mappa, coordinate di ritorno, compresenza dei giocatori, regole di combattimento e riconnessione.

Il RoomManager attuale assume un mondo e partite temporanee a due squadre: non riusarlo per una locanda introducendo altri `if` di modalità. Definire il minimo contratto di spazio/portale solo quando si sceglie davvero questa soluzione. Realizzare un edificio singolo con una funzione prima di una libreria di edifici vuoti.

### Regioni e dungeon

Il mondo procedurale è già generato su richiesta in chunk di 16×16 tile. Le modifiche manuali sono sparse, RLE in chunk da 32×32, con cache di decodifica limitata a 128 chunk, indici spaziali e cache limitate per generazione e terreno. Il documento corrente pesa 169.718 byte con 1.087 chunk modificati, nove asset e 17 istanze manuali. La separazione dei file non ridurrebbe automaticamente il lavoro per frame o la banda degli snapshot.

Le regioni sono utili già come contenuto: nomi, clima, popolazione, PvP e punti di interesse. Separare il caricamento per regione diventa utile se il catalogo iniziale cresce sensibilmente, si vogliono aggiornamenti indipendenti o più autori lavorano in parallelo. Richiede anche manifest/versione coerente client-server, preload e gestione dei confini; non soltanto spezzare un JSON.

Il catalogo dungeon pesa 1.077.966 byte e contiene anche dati di authoring. Le definizioni installate hanno 7.920 tile esplicite complessive. Prossimo miglioramento utile: distinguere formato della bozza e formato runtime compilato, togliendo dal runtime le informazioni esclusivamente editoriali. Valutare poi compressione di terrain e indici per dungeon; con molti dungeon indicizzare geografia e spawn anziché scansionare tutto il catalogo per query/chunk. Anche un catalogo fisicamente separato resta caricato tutto se gli import rimangono eager.

## Cosa conservare e cosa rinviare

Conservare: server autorevole, fisica e generazione condivise, validazione dei documenti, epoch delle stanze, input limitati, cache limitate, maker locali con backup e test sintetici già presenti. I boss hanno già pathfinding e recupero da incastri; gli NPC comuni restano più semplici.

Ridurre o rinviare: copie manuali del codice, placeholder di funzioni ancora inesistenti, nuove valute senza impiego, altre classi prima del bilanciamento, edifici senza funzione, BG complessi, distribuzione multi-server e framework generali non richiesti dal prossimo contenuto.

Prima delle regioni, ottimizzare gli asset realmente caricati: la build contiene diversi SVG sopra 1 MB e tre ritratti PNG per circa 5,23 MB. `prepareSprites` prepara anche le sprite dei boss e degli attacchi al caricamento del renderer. Valutare asset più compatti e caricamento per necessità, conservando fallback; la dimensione su disco non equivale alla misura di download compresso o memoria decodificata.

La priorità pratica è far funzionare e rendere affidabile un ciclo breve e completo: entrare, scegliere un'attività, giocarla, ottenere un esito e avere un motivo per tornare. Gli editor e la generazione sono abbastanza avanzati da sostenere questa fase.
