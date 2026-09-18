# Server autorevole

Le istanze arena/BG e il routing delle sessioni sono descritti in [ROOMS.md](ROOMS.md). Il runtime usa `RoomManager`; l'arena 1v1 si raggiunge dal cerchio a nord del Crocevia. Gli accessi 2v2 e BG non sono ancora attivi. `/health` include gli online totali, `worldOnline` e `matchRooms`.

`index.ts` gestisce HTTP, WebSocket e ciclo di vita. `simulation.ts` contiene il mondo autorevole senza dipendenze di trasporto. `store.ts` gestisce identità e persistenza. `boss-encounter.ts` esegue le definizioni dati presenti in `shared/bosses.ts`; il caso delle rovine è documentato in [RUINS.md](RUINS.md). Il protocollo pubblico e le altre regole condivise sono in `shared/`.

## Avvio

- `npm run dev`: HTTP + `/ws` + Vite sullo stesso server, porta 3000.
- `npm run build` poi `npm start`: serve il bundle `dist/` e il server autorevole.
- `PORT`, `HOST` e `DATA_FILE` sono configurabili tramite ambiente. `HOST` predefinito è `0.0.0.0`; dati predefiniti in `data/accounts.json`.
- `GET /health` espone stato, numero utenti, tick, NPC, chunk attivi e costo dell'ultimo ciclo.

Per l'accesso pubblico usare un proxy HTTPS/WSS, con `/ws` inoltrato allo stesso servizio. Il server verifica l'origine delle connessioni browser rispetto all'host richiesto. Non legge intestazioni IP inoltrate; configurare esplicitamente l'eventuale infrastruttura davanti al servizio prima di introdurre fiducia nel proxy.

## Contratto della simulazione

```ts
const sim = new WorldSimulation(seed, Date.now(), optionalAccountStore);
const actor = sim.addPlayer(account, 'mage');
sim.enqueueInput(actor.id, { seq: 1, dx: 1, dy: 0, aim: 0, cast: 'basic' });
sim.step(1 / 30);
const snapshot = sim.snapshotFor(actor.id);
sim.disconnectPlayer(actor.id);
```

Tutti i timestamp del protocollo sono **millisecondi**; `step` riceve **secondi**. La simulazione avanza a 30 Hz e invia snapshot a 15 Hz. Il client comunica soltanto direzione, mira e abilità: posizione, danni e delta temporale rimangono autorità del server. Ogni tick consuma al massimo un comando per giocatore; la coda conserva al massimo sei comandi e lo snapshot include il numero di sequenza riconosciuto. I comandi scartati dalla coda vengono corretti tramite riconciliazione, senza simulare tempo extra. I cicli di recupero pubblicano una sola fotografia finale; socket con dati ancora in coda saltano la costruzione degli snapshot. `/health` include p95 e massimo di tick e snapshot, byte inviati e conteggio degli snapshot saltati.

`cast`, `socialAction`, `socialFor`, `snapshotFor` e le mappe degli attori sono accessibili per i test della simulazione. Il trasporto valida i messaggi prima di invocarle. Il client riceve solo attori entro il raggio di interesse; un nemico nascosto nei cespugli viene escluso anche dalle liste sociali e dagli eventi se non rivelato.

## Persistenza e sessioni

L'identità usa nome/password con scrypt e un JWT HS256 di 30 giorni. Il trasporto deriva le password in modo asincrono e limita concorrenza e tentativi per IP. Il segreto è in `jwt.secret` o `JWT_SECRET`. Il browser usa `riftlands.jwt` e riprende le connessioni tramite quel token. Non sono disponibili recupero password o revoca server del token al logout. Il formato account v1 viene ancora azzerato: fare un backup prima di caricare un archivio di quella versione.

Gli account salvano nome, XP, uccisioni, morti, amicizie, richieste e stato del personaggio. Le scritture sostituiscono atomicamente il JSON attraverso un file temporaneo. Nuovi account vengono scritti prima di confermare l'accesso; le modifiche sociali sono scritte immediatamente, lo stato del mondo ogni cinque secondi e alla chiusura ordinata. Un crash può perdere gli ultimi cinque secondi di progresso. Un file corrotto interrompe l'avvio con una richiesta esplicita di ripristino, senza sovrascriverlo. Conservare backup esterni del file.

La disconnessione lascia un personaggio vulnerabile per 20 secondi. Una riconnessione riprende quel corpo; dopo la rimozione il corpo viene ripristinato dallo stato conservato, senza cura gratuita o reset dei cooldown. Cambiare classe conserva la percentuale di salute e i cooldown e azzera la risorsa. Una seconda scheda con lo stesso token sostituisce la precedente; la chiusura della prima non disconnette la seconda.

## Confini attuali

Questa è una base per un singolo processo, non un MMO distribuito già pronto per la produzione.

- Massimo 128 corpi giocatore, 150 connessioni WebSocket e 12 connessioni per IP diretto.
- Team fino a cinque membri; amicizie fino a 100; richieste ricevute fino a 50.
- Chunk simulati nel vicinato 3×3 dei giocatori; disattivazione dopo 20 secondi senza interesse.
- Fino a 1.152 chunk attivi, 3.000 NPC e 1.000 proiettili. Eventi recenti limitati a 500.
- Gli NPC disattivati conservano stato e cooldown per cinque minuti in una cache di massimo 5.000 elementi; oltre questo intervallo il terreno ricrea gli NPC da seed. Le morti NPC durano 35 secondi.
- I power-up consumati ricompaiono dopo 35 secondi, anche se il relativo chunk viene disattivato nel frattempo.
- Team e inviti sono temporanei; amicizie e account sopravvivono al riavvio. Il caposquadra passa a un membro online alla scadenza della grazia di disconnessione.
- Heartbeat di trasporto, limite messaggi, dimensione massima 4 KB e gestione del buffer impediscono code di rete senza limiti.

I limiti sono salvaguardie iniziali, non capacità garantite da benchmark. Per espandere il servizio: sostituire `AccountStore` con un database transazionale, assegnare regioni a processi separati, introdurre trasferimento autorevole dei personaggi e osservabilità/capacity test prima di aumentare i limiti.
