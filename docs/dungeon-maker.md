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

- `shared/custom-dungeons.json.<data-ora-UTC>-<id>--dungeon-<dungeon-id>.bak`: tutto il catalogo, comprese le bozze installate e i parametri dei boss.
- `data/dungeon.json.<data-ora-UTC>-<id>--dungeon-<dungeon-id>.bak`: gli stati dei boss, se il file esiste. Prima della migrazione al formato separato, la copia riguarda invece `accounts.json`. Se il salvataggio non esiste, viene copiato solo il catalogo.

Le due copie hanno lo stesso suffisso e i percorsi compaiono nel messaggio dello Studio. Servono per annullare un aggiornamento errato o recuperare da una scrittura interrotta. Il gioco ignora i `.bak`: non duplica dungeon e non li carica in memoria. Occupano spazio su disco, restano locali e non vengono eliminati automaticamente. Puoi cancellare le copie che non ti servono dopo aver verificato la nuova versione, direttamente nello Studio.

Nel pannello **Backup locali** scegli il dungeon (anche se già eliminato), verifica numero, dimensione ed elenco dei file e premi **Elimina backup selezionati**. Puoi scegliere anche **Tutti i backup**. La conferma elimina definitivamente le copie selezionate, senza modificare catalogo e account attuali e senza generare altri backup.

L'associazione identifica il dungeon che ha causato l'operazione: ogni copia contiene comunque il catalogo o gli stati di **tutti** i boss, quindi cancellarla elimina anche quella possibilità di recupero per gli altri contenuti presenti nella copia. I vecchi file senza associazione compaiono come **Storici / condivisi**; non vengono attribuiti a un dungeon per supposizione. Le operazioni sull'intero catalogo usano il suffisso `--catalog` e un gruppo dedicato. Il pannello cerca solo i `.bak` accanto al catalogo, al file account e al file dungeon, non cancella esportazioni o bozze in altre cartelle.

Per ripristinare tutto: ferma gioco e Studio, copia i due file con lo stesso suffisso sui rispettivi originali (senza `.bak`), poi ricompila e riavvia. I backup creati dopo la migrazione non modificano i progressi dei giocatori; i vecchi backup di `accounts.json` sì. Per recuperare soltanto una mappa, estrai la sua bozza dal vecchio catalogo e importala/aggiornala nello Studio.

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
- Più boss nello **stesso incontro** condividono preparazione, partecipanti e fiamme: vittoria quando tutti sono morti. Oro e XP vengono assegnati solo al completamento. La morte di un partecipante interrompe l’incontro e ripristina anche i boss già uccisi; i superstiti possono uscire e rientrare per riprovare. Il respawn dopo la vittoria usa la durata massima dei boss.
- **Incontri separati** nella stessa mappa hanno regioni senza sovrapposizioni, ciascuna con boss, 1–5 spawn, punti di attivazione e fiamme propri. Puoi combinare incontri singoli e multipli.
- **Chiusura automatica**: tutto il perimetro della mappa diventa roccia mentre un incontro è attivo, anche dove hai dipinto erba, pavimento o acqua. Alla vittoria o alla morte di un partecipante il terreno originale ritorna, purché non restino altri incontri attivi nella stessa mappa. Nessuna barriera manuale da configurare agli ingressi.
- Fiamme con posizione iniziale, lunghezza in caselle e orientamento, solo all’interno della mappa. Il bordo è riservato ai massi. **Fiamma in un punto casuale** sceglie una casella libera nell’incontro selezionato e salva quella posizione nella bozza. Durante il fight il contatto uccide i partecipanti; uscire dalla regione del fight è anch’esso letale.
- I punti di attivazione e le fiamme sono indipendenti. Solo **Fiamme** crea barriere, spente prima del combattimento e accese appena inizia. Non ci sono attese aggiuntive o immunità iniziali: il developer dispone correttamente attivatori, spawn e fiamme. Il riposizionamento sugli spawn avviene una sola volta, alla partenza.
- Le punte delle fiamme sono rivolte verso l'interno: una linea orizzontale nella metà nord punta in basso, nella metà sud in alto; una linea verticale nella metà ovest punta a destra, nella metà est a sinistra. Vale anche per barriere intermedie e da una casella. Le frecce nel maker anticipano il verso nel gioco; hitbox e posizione della linea non cambiano.
- Dopo la prima rilevazione o il primo danno il boss mantiene l'aggro per tutta l'area di combattimento, anche lontano dallo spawn o senza linea visiva. Movimento, cariche e recupero dagli ostacoli restano entro il limite dell'incontro. Torna allo spawn dopo la morte di un partecipante o al respawn, non per la distanza del bersaglio.
- **Zona visitatori**: seleziona l'incontro e dipingi le caselle accessibili ai non partecipanti con il pennello blu molto trasparente. **Cancella zona visitatori** rimuove solo la marcatura, lasciando terreno, NPC e altre entità invariati. Undo/redo, salvataggio, importazione ed esportazione conservano questo livello separato. Puoi includere muri nel pennello: mantengono le normali collisioni.
- Durante uno scontro attivo, gli estranei già presenti possono restare nelle caselle blu. I massi impediscono nuovi accessi dall’esterno. Il server verifica l’ingombro del personaggio: se entra nell’area riservata viene spostato al punto di espulsione esterno. Senza zone blu gli estranei vengono espulsi dalla regione dello scontro.
- Un visitatore non entra nella lista dei partecipanti, non provoca aggro del boss e non può danneggiarlo. Le regole PvP e quelle dei partecipanti restano invariate: il blu non è una zona protetta dal PvP né un'uscita sicura dalle fiamme per chi sta combattendo. Prima della partenza restano validi i normali attivatori e la raccolta dei compagni nei 5 secondi. Il colore blu serve solo all'authoring e non viene disegnato nel gioco.
- Selezione, trascinamento, cancellazione, pennello continuo, zoom, pan con tasto destro, undo/redo (50 modifiche), Ctrl/Cmd+Z.
- **Powerup e powerdown**: cura (+35 HP), velocità (10 secondi), potenza (+30% danni, 10 secondi), debolezza (−30% danni, 7 secondi). Si raccolgono al contatto e ricompaiono dopo 35 secondi. Salvataggio, importazione, installazione e prova locale conservano queste entità.
- Controlli di terreno, ingombro, regioni, sovrapposizioni e raggiungibilità. Tutti gli errori restano visibili: cliccane uno per selezionare le entità coinvolte, evidenziare le caselle e leggere una spiegazione della correzione.

## Prova gioco locale

Scegli la classe accanto a **Prova gioco locale**. Il dungeon viene copiato in un’area isolata con esattamente due caselle di erba su ogni lato e un limite invalicabile esterno. Il personaggio inizia fuori da un ingresso; nessun terreno o mostro procedurale viene generato.

La prova usa la stessa simulazione e lo stesso renderer del gioco: movimento, collisioni, NPC, boss, proiettili, abilità, attivazione, massi, fiamme, bonus, morte e rinascita. Funziona nel browser senza login, WebSocket di gioco o server di simulazione. Occorre soltanto caricare la pagina e le risorse del maker. Bozza, catalogo e account non vengono modificati dalla partita; **Ricomincia** azzera lo stato della prova. È una prova singolo giocatore; le dinamiche di squadra richiedono più giocatori nel gioco normale.

WASD/frecce per muoversi, mouse per mirare, click/spazio per attaccare, Q/E/R per le abilità. Il pannello mostra salute, risorsa, effetti e cooldown. Esc o **Torna al maker** termina la prova. Le bozze con errori o boss segnaposto senza comportamento vanno corrette prima di giocare.

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

Per ripristinare, a server fermo copia entrambi i backup sui rispettivi originali e ricostruisci il client. La sostituzione di ciascun file avviene tramite rinomina, ma i due file non costituiscono una transazione unica: se il processo si interrompe dopo la pulizia del salvataggio, ripeti la rimozione oppure ripristina entrambi i backup prima di avviare. I backup precedenti alla migrazione possono contenere dati degli account: conservali con le stesse restrizioni del salvataggio.

**Perché pulire anche `bosses`:** il caricamento verifica ogni ID contro il catalogo dei boss attuali. Dopo un aggiornamento incompatibile, `dungeon.json` viene comunque azzerato automaticamente e il vecchio contenuto resta in un backup `.invalid-…bak`. Gli account non vanno cancellati.

Per azzerare tutto il catalogo, compresi tutti gli stati persistenti dei boss (anche residui di vecchie mappe), usa `npm run dungeon:remove -- --all`. Aggiungi `--check` per l'anteprima. Account e file sorgenti delle bozze restano conservati. I vecchi dungeon integrati non vengono più caricati.

## Limiti ancora presenti

Regioni rettangolari condivise tra ammissione, combattimento e leash; aggro circolare per boss e attivatori puntuali; non ancora poligoni distinti disegnabili. Mancano playtest multiplayer nell’editor, libreria multiprogetto e pubblicazione amministrativa remota. Aggiornare una mappa azzera lo stato dei suoi boss: non migra un fight in corso. Il database non è necessario per questo flusso.
