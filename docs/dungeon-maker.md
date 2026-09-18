# Dungeon maker

Apri `/dungeon-maker.html` o **Dungeon maker** nel menu. Nessun login o WebSocket: l'editor salva una bozza nel browser e non modifica il mondo in esecuzione. Esporta le bozze per conservarle e trasferirle.

## Gestire il catalogo dal maker

Per creare, riaprire, aggiornare ed eliminare dungeon senza modificare JSON a mano:

```sh
npm run dungeon:studio
```

Apri l'indirizzo stampato (normalmente `http://127.0.0.1:3001/dungeon-maker.html`). Nel pannello **Catalogo installato**:

- **Installa bozza** aggiunge la mappa corrente, dopo la validazione.
- **Apri nel maker** recupera la bozza originale conservata nel catalogo, con ID, entità e incontri.
- **Aggiorna bozza installata** sostituisce la mappa con lo stesso ID e azzera soltanto gli stati dei suoi boss, compreso il loot non raccolto. Account e ricompense già raccolte restano invariati.
- **Elimina dungeon selezionato** rimuove la voce scelta e gli stati dei boss associati.

Ferma il server di gioco prima delle scritture. Studio, CLI e server condividono un lock sul salvataggio: un'operazione viene rifiutata se quel file è in uso. Lo Studio usa `DATA_FILE` oppure `data/accounts.json`; `STUDIO_PORT` cambia la porta. Il processo resta in ascolto solo sul computer locale, controlla origine e token delle richieste e non aggiunge API amministrative al server di gioco. I pulsanti di gestione sono disponibili solo in questa modalità.

Ogni modifica crea backup; il messaggio indica i percorsi. Dopo aver finito, chiudi lo Studio con Ctrl+C, esegui `npm run build` e riavvia il gioco. Le modifiche non sono applicate a una partita già aperta.

Tutte le mappe installate risiedono in `shared/custom-dungeons.json`, incluse le relative bozze. I comportamenti riutilizzabili dei boss sono in `shared/boss-templates.ts`: eliminare una mappa non elimina i modelli selezionabili. Non ci sono mappe integrate o layout storici nel codice; i test costruiscono piccole mappe sintetiche attraverso il maker.

Scegli un modello dal catalogo **Boss disponibili**: il riferimento resta valido anche se elimini ogni dungeon. I modelli sono identificati da `stone-warden` e `maze-stalker` e conservano i rispettivi comportamenti di combattimento.

## Backup dello Studio

Installa, Aggiorna ed Elimina salvano una copia **precedente alla modifica** dei file, prima di sostituirli. Dipingere nel maker, salvare la bozza nel browser o scaricare un JSON non crea questi backup.

- `shared/custom-dungeons.json.<data-ora-UTC>-<id>.bak`: tutto il catalogo, comprese le bozze installate e i parametri dei boss.
- `data/accounts.json.<data-ora-UTC>-<id>.bak`: il salvataggio completo, con account, progressi e stati dei boss. Se usi `DATA_FILE`, la copia viene creata accanto a quel file. Se il salvataggio non esiste, viene copiato solo il catalogo.

Le due copie hanno lo stesso suffisso e i percorsi compaiono nel messaggio dello Studio. Servono per annullare un aggiornamento errato o recuperare da una scrittura interrotta. Il gioco ignora i `.bak`: non duplica dungeon e non li carica in memoria. Occupano spazio su disco, restano locali e non vengono eliminati automaticamente. Puoi cancellare le copie che non ti servono dopo aver verificato la nuova versione.

Per ripristinare tutto: ferma gioco e Studio, copia i due file con lo stesso suffisso sui rispettivi originali (senza `.bak`), poi ricompila e riavvia. Ripristinare `accounts.json` riporta **anche i progressi dei giocatori** alla data della copia. Per recuperare soltanto una mappa, estrai la sua bozza dal vecchio catalogo e importala/aggiornala nello Studio, senza sostituire il salvataggio degli account.

## Authoring

- Mappe 8×8–96×96; caselle da 48 unità. Terreno: erba, pavimento, muro, acqua, cespuglio, fango.
- Tutti gli NPC attuali: gelatina, fuoco fatuo, guardiano; livello individuale. Tutti i boss del catalogo sono selezionabili, anche più copie dello stesso modello.
- Boss futuri come segnaposto con nome, posizione e raggio; nessuna logica di combattimento richiesta per salvare la bozza.
- Incontri: nome e regione rettangolare, modificabile dall'ispettore e visibile sulla mappa. Assegna ogni boss, spawn, attivatore e barriera al suo incontro.
- **Spawn gruppo**: da 1 a 5 posizioni in cui vengono collocati i partecipanti all'avvio. Per un team completo posiziona 5 spawn distinti; se ne metti meno, vengono riutilizzati in ordine. Passare su uno spawn non attiva il dungeon.
- **Punto di attivazione**: marcatore invisibile nel gioco, distinto da spawn e fiamme. Puoi piazzarne più di 5 e dipingerli trascinando; resta il limite generale di 500 entità per bozza. Ogni punto copre un cerchio di raggio 24 unità più il raggio del player, dentro la regione dell'incontro.
- Il contatto con un punto **oppure l'ingresso nell'aggro di uno dei boss** avvia subito il solo, o 5 secondi di preparazione per un gruppo. Alla partenza i giocatori sono collocati sugli spawn e le fiamme si accendono. I compagni dentro la regione durante la preparazione partecipano; uscita, morte o disconnessione dell'iniziatore annullano la preparazione.
- Seleziona un boss e imposta **Raggio aggro**, in unità mondo (48 = una casella, default 288 = 6 caselle). Il cerchio è visualizzato nel maker, limitato alla regione dell'incontro. È specifico della singola posizione del boss, non cambia il modello condiviso. La rilevazione è per distanza, anche attraverso pareti; i colpi del boss rispettano la linea visiva.
- **Attivazione e inseguimento sono separati**: un punto può chiudere un labirinto mentre il boss lontano resta fermo. Ogni boss comincia a inseguire quando un partecipante entra nel suo aggro o lo danneggia. Da quel momento non perde aggro per distanza finché l'incontro non termina.
- Più boss nello **stesso incontro** condividono preparazione, partecipanti e fiamme: vittoria quando tutti sono morti. Oro e XP vengono assegnati solo al completamento; un wipe ripristina anche i boss già uccisi. Il respawn comune usa la durata massima dei boss.
- **Incontri separati** nella stessa mappa hanno regioni senza sovrapposizioni, ciascuna con boss, 1–5 spawn, punti di attivazione e fiamme propri. Puoi combinare incontri singoli e multipli.
- Fiamme con posizione iniziale, lunghezza in caselle e orientamento. Seguono la meccanica esistente: durante il fight il contatto uccide i partecipanti; non sono un muro che arresta il movimento. Uscire dalla regione del fight è anch'esso letale.
- I punti di attivazione e le fiamme sono indipendenti. Solo **Fiamme** crea barriere, spente prima del combattimento e accese appena inizia. Non ci sono attese aggiuntive o immunità iniziali: il developer dispone correttamente attivatori, spawn e fiamme. Il riposizionamento sugli spawn avviene una sola volta, alla partenza.
- Le punte delle fiamme sono rivolte verso l'interno: una linea orizzontale nella metà nord punta in basso, nella metà sud in alto; una linea verticale nella metà ovest punta a destra, nella metà est a sinistra. Vale anche per barriere intermedie e da una casella. Le frecce nel maker anticipano il verso nel gioco; hitbox e posizione della linea non cambiano.
- Dopo la prima rilevazione o il primo danno il boss mantiene l'aggro per tutta l'area di combattimento, anche lontano dallo spawn o senza linea visiva. Movimento, cariche e recupero dagli ostacoli restano entro il limite dell'incontro. Torna allo spawn solo dopo un wipe o al respawn, non per la distanza del bersaglio.
- Selezione, trascinamento, cancellazione, pennello continuo, zoom, pan con tasto destro, undo/redo (50 modifiche), Ctrl/Cmd+Z.
- Controlli di terreno, ingombro, regioni, sovrapposizioni e raggiungibilità. Anteprima del movimento con collisioni e fango; non simula il combattimento.

Le bozze incomplete possono essere salvate. La compilazione richiede posizioni valide. Copiare un dungeon dal catalogo mantiene boss e fiamme, aggancia le posizioni alla griglia e approssima le regioni con rettangoli: controllare la copia prima di usarla.

## Dove mettere il dungeon

1. Crea terreno, boss, NPC, incontri, ingressi e fiamme. Apri almeno una casella sul bordo per l'accesso dal mondo.
2. Imposta un ID nuovo e premi **Scegli sulla mappa del mondo**. Clicca per posizionare l'ingombro, trascina per esplorare, usa rotella o pulsanti per lo zoom e conferma con **Usa questa posizione**. Le sovrapposizioni bloccano la conferma. Le coordinate restano disponibili tra le opzioni avanzate. Il maker non crea un'istanza privata.
3. **Salva dungeon** e conserva il file in `content/dungeons/nome.draft.json` (o un altro percorso a scelta).
4. Dalla cartella del progetto esegui:

   ```sh
   npm run dungeon:import -- content/dungeons/nome.draft.json
   npm run build
   ```

5. Riavvia il server con la nuova build. Per un server remoto distribuisci anche `shared/custom-dungeons.json` e la build client insieme al codice server aggiornato.

Il comando valida il file, collega ogni boss al comportamento scelto e scrive il catalogo condiviso `shared/custom-dungeons.json`. Client e server caricano la stessa geometria e gli stessi ID. Genera un breve accesso esterno verso l'apertura e un punto di espulsione fuori dalla mappa. I segnaposto senza un modello implementato bloccano l'installazione, ma si possono salvare ed esportare nell'editor.

L'importazione rifiuta ID già installati e mappe troppo vicine/sovrapposte. Per aggiornare esplicitamente un ID esistente usa **Aggiorna bozza installata** nello Studio oppure `npm run dungeon:import -- percorso/file.json --replace`. L'aggiornamento azzera gli stati dei boss di quella mappa, conserva gli account e crea backup prima delle modifiche. `--replace --check` verifica senza scrivere. Conserva comunque le esportazioni originali per trasferire e versionare le bozze.

**Importa dungeon** e il comando accettano sia le bozze sia le esportazioni runtime generate dal maker. Il recupero runtime mantiene terreno, posizioni e modelli dei boss; regole personalizzate non rappresentabili vengono rifiutate. Se `area` è incoerente con i tile viene segnalata e ricalcolata: modificare il solo centro non sposta un dungeon. Per riposizionare un vecchio runtime importalo nel maker, scegli sulla mappa del mondo e salva il dungeon.

Per verificare senza installare né modificare file:

```sh
npm run dungeon:import -- content/dungeons/nome.json --check
```

Gli errori del comando vengono mostrati con una spiegazione senza stack trace. **Esporta runtime (avanzato)** resta utile per ispezionare la definizione compilata.

## Eliminare un dungeon installato (sviluppatori)

Eliminare il file in `content/dungeons/` rimuove soltanto la bozza: il mondo carica il catalogo `shared/custom-dungeons.json`. Per disinstallare un dungeon personalizzato:

1. **Ferma il server** per tutta l'operazione. Il comando non lo arresta: rifiuta la scrittura se il salvataggio è occupato dal server aggiornato. Anche eventuali vecchie versioni del server, prive del lock, devono essere spente.
2. Trova l'ID installato (non il nome del file) e, facoltativamente, verifica cosa verrà rimosso:

   ```sh
   npm run dungeon:remove -- --list
   npm run dungeon:remove -- ID-DUNGEON --check
   ```

3. Disinstalla con un solo comando:

   ```sh
   npm run dungeon:remove -- ID-DUNGEON
   ```

   Il comando rimuove il dungeon da `shared/custom-dungeons.json` e gli stati di **tutti** i suoi boss dal salvataggio, compresi quelli degli incontri aggiuntivi. Account, oro già guadagnato e altri boss restano invariati. Vengono eliminati loot non raccolto e timer dei boss rimossi. La bozza originale su disco e quella nel browser restano disponibili.

   Il salvataggio usato è quello indicato da `DATA_FILE`, altrimenti `data/accounts.json`. Puoi indicarlo esplicitamente (anche con `--check`):

   ```sh
   npm run dungeon:remove -- ID-DUNGEON --data-file percorso/accounts.json
   ```

   Prima delle modifiche vengono creati backup `.bak` accanto al catalogo e al salvataggio, con lo stesso identificativo; i percorsi sono stampati nel terminale. `--check` non scrive neppure i backup. Se il salvataggio non esiste, viene segnalato e non ne viene creato uno: verifica di aver scelto il percorso effettivamente usato dal server. Formati non supportati e JSON malformati bloccano l'operazione senza modificare gli originali.

4. Esegui `npm run build` e riavvia. Per un server remoto, esegui la pulizia sul suo salvataggio effettivo e distribuisci catalogo, client e server aggiornati insieme. Verifica la zona rimossa: il terreno torna procedurale e le posizioni salvate dei giocatori non vengono spostate automaticamente.

Per ripristinare, a server fermo copia entrambi i backup sui rispettivi originali e ricostruisci il client. La sostituzione di ciascun file avviene tramite rinomina, ma i due file non costituiscono una transazione unica: se il processo si interrompe dopo la pulizia del salvataggio, ripeti la rimozione oppure ripristina entrambi i backup prima di avviare. I backup contengono anche i dati degli account: conservali con le stesse restrizioni del salvataggio.

**Perché pulire anche `bosses`:** il caricamento del salvataggio verifica ogni ID contro il catalogo dei boss attuali. Uno stato rimasto per un boss eliminato impedisce l'avvio con `Stato boss non valido`. Non aggirare questo controllo cancellando gli account.

Per azzerare tutto il catalogo, compresi tutti gli stati persistenti dei boss (anche residui di vecchie mappe), usa `npm run dungeon:remove -- --all`. Aggiungi `--check` per l'anteprima. Account e file sorgenti delle bozze restano conservati. I vecchi dungeon integrati non vengono più caricati.

## Limiti ancora presenti

Regioni rettangolari condivise tra ammissione, combattimento e leash; aggro circolare per boss e attivatori puntuali; non ancora poligoni distinti disegnabili. Mancano playtest AI nell'editor, libreria multiprogetto e pubblicazione amministrativa remota. Aggiornare una mappa azzera lo stato dei suoi boss: non migra un fight in corso. Il database non è necessario per questo flusso.
