# Replicazione degli snapshot — protocollo 9

La simulazione conserva lo stato autorevole. La rete pubblica una proiezione esplicita di quello stato e il client ricostruisce le viste necessarie a predizione, interpolazione e interfaccia. Aggiungere un campo ad `Actor` non lo trasmette automaticamente.

## Responsabilità

- `server/simulation.ts`: gameplay, stato e invalidazione delle viste quando cambia fuori dal normale avanzamento dei tick.
- `server/snapshot-builder.ts`: selezione dell'interesse e costruzione della vista per destinatario. L'indice spaziale e quello dei team vengono ricostruiti una volta per tick; includono cadaveri e compagni lontani. La visibilità usa la stessa funzione del combattimento, in `server/actor-visibility.ts`.
- `server/snapshot-private-state.ts`: viste private staccate dagli account, congelate e riutilizzate finché inventario o revisione narrativa non cambiano. I riferimenti e le revisioni interne della cache non vengono pubblicati.
- `shared/snapshot-actor.ts`: elenco dei campi pubblici, metadati e stato degli attori. Copia effetti e cooldown per evitare riferimenti allo stato autorevole.
- `shared/snapshot-stream.ts`: codifica per destinatario e ricostruzione. Le differenze fra proiezioni immutabili comuni vengono calcolate una sola volta anche quando più destinatari osservano gli stessi attori.
- `server/index.ts`: invio del pacchetto e conferma della baseline solo se il trasporto accetta l'invio.
- `client/net.ts`: ricostruzione prima di consegnare uno snapshot al resto del client.

Le proiezioni sono condivise solo all'interno dello stesso tick. `SnapshotBuilder.invalidate()` va chiamato quando si modifica direttamente un attore dopo aver prodotto una vista in quel tick. Le operazioni pubbliche di aggiunta giocatore, cast e socialità lo fanno già; anche la ricostruzione delle celle invalida la cache. I marcatori quest vengono aggiunti alla vista del singolo destinatario.

## Contratto e baseline

Il pacchetto conserva `type: snapshot` e aggiunge `encoding: actors-v1`, identità stanza `{id, epoch}`, `sequence`, `base`, `actorUpdates` e `removedActors`.

`self` rimane completo per la riconciliazione ed è escluso dagli aggiornamenti remoti. Alla ricostruzione viene reinserito una sola volta in `actors`.

Un attore nuovo riceve metadati e stato completi. Negli aggiornamenti successivi vengono inviati solo i campi di stato cambiati; i metadati vengono sostituiti per intero quando cambiano. `clear` rimuove esplicitamente i campi opzionali, perché JSON omette `undefined`. Un'uscita dall'interesse elimina l'attore; il rientro riceve di nuovo tutti i dati.

`base: null` indica un keyframe completo. Viene inviato all'inizio, al cambio stanza e ogni 75 snapshot effettivamente inviati, circa cinque secondi a 15 Hz. Ogni nuova sessione ha un encoder nuovo. Il decoder viene azzerato al cambio stanza e alla chiusura del socket.

Preparare un pacchetto non avanza la baseline: `commit()` segue un invio riuscito. Il server può quindi saltare snapshot su connessioni lente senza perdere aggiornamenti di attori o dati privati. Sequenze obsolete, stanza errata e baseline mancanti vengono rifiutate; il client avvia una riconnessione in caso di ricostruzione fallita. Le viste già consegnate al client non condividono stato mutabile con la baseline o con i frame futuri.

Inventario e gold vengono conservati nella vista ricostruita anche quando sono omessi dal pacchetto. La narrativa mantiene il comportamento del journal: compare negli snapshot al cambiamento o al keyframe; la UI ne conserva l'ultimo aggiornamento.

## Verifica e misure

Comandi riproducibili:

```sh
npm run build
node --import tsx --test tests/snapshot-stream.test.ts tests/net.test.ts tests/snapshots.test.ts tests/rooms.test.ts tests/interactions.test.ts
node --import tsx --test --test-concurrency=1 tests/integration/hud-browser.test.ts tests/integration/world-render.test.ts tests/integration/snapshot-stream-browser.test.ts tests/integration/sessions.test.ts
npm test
npm run benchmark:server -- --moving --players=128 --layout=crowded
```

La build e i 48 test mirati passano. Le cinque verifiche browser/trasporto passano: HUD desktop e touch, input dopo interazioni con mappa e team, rendering dei livelli del mondo, sessioni e movimento locale/remoto con due browser. I server temporanei vengono chiusi nei blocchi di cleanup.

La suite generale ha 236 test: 219 passano e restano i 17 fallimenti già presenti nella review. Riguardano i presupposti storici di arena, sanctuary, geometria, generazione e formato di persistenza. Il loro riallineamento resta rinviato secondo le priorità concordate. La verifica browser storica del combattimento continua a usare una posizione oggi dentro una zona sicura e non supera l'aspettativa sui cast ripetuti.

Benchmark locale in memoria: 360 tick, 60 di riscaldamento, frequenza snapshot 15 Hz. La misura include costruzione, codifica, serializzazione e commit, senza socket, TLS o disco. Il confronto serializza separatamente la vista completa dello stesso scenario, fuori dal timer di broadcast. Keyframe inclusi.

| Giocatori concentrati | Delta MiB/s | Viste complete MiB/s | Riduzione payload |
| --- | ---: | ---: | ---: |
| 16 fermi | 0,31 | 1,89 | 83,4% |
| 128 fermi | 3,77 | 104,86 | 96,4% |
| 128 in movimento | 19,24 | 104,74 | 81,6% |

L'ultima ripetizione con 128 giocatori in movimento ha step p95 3,67 ms e broadcast p95 15,03 ms. Le ripetizioni sulla stessa macchina hanno però mostrato broadcast p95 fra circa 15 e 96 ms: il dato CPU è variabile e non certifica una capacità da 128 giocatori. Il payload è rimasto uguale nelle ripetizioni. Nel caso fermo da 128 giocatori il broadcast p95 misurato è 9,92 ms.

## Limiti e prossimi confini

Proiettili, pickup, trappole, eventi e stato dei boss conservano il formato completo e i filtri esistenti. Non sono stati introdotti quantizzazione, formato binario o una seconda autorità di gameplay nel client.

Il renderer ora importa minimappa, rasterizzazione sprite e primitive grafiche da moduli dedicati. La UI importa ritratti e icone da `client/ui-art.ts`. La scomposizione completa di terreno, attori, HUD e lobby resta progressiva: i due orchestratori sono ancora grandi.

La persistenza conserva il comportamento precedente, incluse serializzazione e scritture sincrone. Una coda ordinata con interfaccia e gestione degli errori è un intervento successivo distinto dalla replicazione. NPC, world builder, dungeon, regole delle ricompense e coordinate dei test storici non sono stati modificati.
