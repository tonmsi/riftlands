# Persistenza ordinata

Il server live usa una sola coda per le scritture di `accounts.json` e `dungeon.json`. Il gameplay richiede salvataggi tramite un'interfaccia; i writer gestiscono serializzazione, ordinamento e sostituzione dei file.

## Responsabilità

- `server/gameplay-persistence.ts`: contratto minimo usato da simulazione, boss e stanze. Espone lo stato condiviso degli account e dei boss e le operazioni `touch`, `flush`, `flushBosses`, `drain`; non espone metodi di autenticazione, percorsi o implementazione dell'I/O.
- `server/store.ts`: account, autenticazione, caricamento, migrazioni e costruzione dei documenti da salvare.
- `server/save-writer.ts`: writer sincrono per fixture/strumenti offline e writer ordinato con I/O asincrono per il server live.
- `server/index.ts`: scelta del writer live, controllo degli errori e completamento della coda alla chiusura.

I formati JSON e i file esistenti restano compatibili. Lettura iniziale, generazione del segreto e backup delle migrazioni avvengono all'avvio; tutte le scritture accodate dalle migrazioni terminano prima che il server accetti connessioni.

## Ordinamento e attese

`flush()` accoda il documento corrente quando gli account sono cambiati. `flushBosses()` accoda gli stati boss. Il JSON viene serializzato al momento della richiesta: successive modifiche agli oggetti in memoria non cambiano il contenuto già accodato.

Il writer avvia il lavoro nel turno successivo dell'event loop e completa una sostituzione prima di iniziare la seguente. Usa file temporaneo con permessi `0600` e rename nella stessa directory. Se la sostituzione fallisce, prova a rimuovere il temporaneo e propaga l'errore.

Solo i salvataggi consecutivi dello stesso file ancora in attesa vengono accorpati, mantenendo il più recente. Un salvataggio già iniziato prosegue. Una scrittura dungeon fra due scritture account impedisce l'accorpamento, preservando l'ordine fra file.

`drain()` attende tutte le richieste precedenti alla chiamata; non aspetta quelle arrivate dopo. Se una richiesta viene accorpata, il completamento del documento che la sostituisce soddisfa anche la sua attesa.

Le attese esplicite sono usate per:

1. Confermare una nuova registrazione solo dopo il salvataggio dell'account.
2. Completare la gestione di interazioni e azioni sociali dopo la scrittura richiesta. Lo stato in memoria può già comparire negli snapshot periodici durante l'attesa.
3. Trasferire giocatori in una stanza solo dopo il checkpoint del ritorno nel mondo.
4. Completare il checkpoint finale e tutte le scritture già richieste prima dell'uscita e del rilascio del lock dei dati.

Le nuove autenticazioni vengono rifiutate quando il server chiude. La derivazione password già avviata può terminare, ma un segnale di cancellazione impedisce di creare account o aggiornare login dopo l'inizio della chiusura. Le nuove ammissioni in partita vengono fermate prima del checkpoint finale.

## Stanze

`RoomManager.createMatch()` restituisce ora `Promise<string>` e va atteso. I partecipanti e uno slot stanza vengono riservati durante il salvataggio, senza fermare il mondo. Prima del trasferimento vengono ricontrollati connessione, stanza, epoch, vita e stato di combattimento.

La preparazione dell'istanza avviene dopo l'attesa, con il tempo corrente della simulazione. Se un giocatore si disconnette, rientra, cambia classe o torna in combattimento durante l'attesa, l'ingresso si annulla e le riserve vengono liberate. Il gate annulla anche una coppia uscita dall'ingresso, anche se torna prima che il salvataggio finisca.

## Errori e limiti

Un errore di scrittura blocca la coda e rifiuta le attese. I documenti successivi non possono nascondere una scrittura fallita. Il server diventa non disponibile, registra l'errore e termina con codice 1. Non viene tentato un retry automatico che potrebbe far apparire riuscita un'operazione già rifiutata.

La coda ammette al massimo 128 documenti in attesa oltre alla scrittura attiva. Se il disco resta indietro e gli accorpamenti non bastano, segnala il sovraccarico e avvia la stessa chiusura per errore. Anche in questo caso la chiusura aspetta la sostituzione già avviata prima di uscire.

La serializzazione JSON resta nel thread principale: l'intervento elimina le scritture sincrone dal loop live, non il costo CPU di costruire e serializzare i documenti. Prima di introdurre worker o un database occorre misurare quel costo su account reali.

La sostituzione è atomica per singolo file. Non viene introdotta una transazione fra account e dungeon, né una garanzia aggiuntiva contro perdita di alimentazione: comportamento delle ricompense e limiti in caso di crash restano quelli concordati nella review. I checkpoint periodici restano ogni cinque secondi.

## Verifiche

```sh
npm run build
node --import tsx --test tests/save-writer.test.ts tests/rooms.test.ts tests/auth.test.ts tests/interactions.test.ts tests/boss-encounter.test.ts
node --import tsx --test --test-concurrency=1 tests/integration/save-shutdown.test.ts tests/integration/sessions.test.ts tests/integration/snapshot-stream-browser.test.ts
npm test
```

I test dedicati coprono scritture lente, accorpamento, barriere, errori, sovraccarico, pulizia dei temporanei, reload dei progressi, registrazioni non confermate e annullamento dei trasferimenti. Il test di shutdown usa un server reale con dati temporanei e verifica il corpo del personaggio salvato, l'uscita regolare e il rilascio del lock. I processi vengono chiusi nel cleanup.

Verifica del 3 ottobre 2026: build riuscita, 44 test mirati e quattro verifiche di trasporto/browser passate, incluso un errore disco provocato nel server reale con conservazione del file account precedente. La suite generale ha 248 test: 231 passati e gli stessi 17 fallimenti preesistenti rinviati nella review.
