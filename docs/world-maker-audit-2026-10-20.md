# World Maker: audit logico e proposta UX

Data: 20 ottobre 2026. Analisi del codice e riproduzioni browser con Chrome headless, su documenti temporanei. Nessuna modifica ai contenuti del progetto o al comportamento dell'editor.

Aggiornamento dopo l'audit: i sette difetti qui descritti sono stati affrontati nella
prima implementazione del workspace, insieme alla selezione precisa dei PNG, ai box
compatti, alle colonne ridimensionabili, all'esploratore e al limite di un livello
per volta nel disegno del terreno. È stato inoltre ripristinato il pulsante di
posizionamento dungeon, rimosso per errore dal riordino dei pannelli. Questa prima
implementazione non comprende un authoring generale delle missioni o finestre
indipendenti staccabili. Il testo seguente conserva i risultati dell'audit iniziale.

Il problema principale è la sovrapposizione dei contesti: mappa aperta, area selezionata nel pannello, quota attiva, quote visibili, istanza selezionata, asset di catalogo e destinazione della geometria. L'utente deve ricordare questi stati mentre passa fra controlli distanti. I pannelli ridimensionabili aiuterebbero, ma serve prima rendere esplicito e coerente il destinatario delle operazioni.

## Difetti riprodotti

### 1. P1 — Due schede possono sovrascrivere la bozza senza conflitto

**Riproduzione:** aprire lo stesso Studio in due schede; nella A rinominare un asset e attendere il salvataggio della bozza; nella B cambiare una dimensione dello stesso asset. Nel checkpoint condiviso ricompare il vecchio nome. Riaprendo l'editor si recupera la versione della B, perdendo la modifica della A.

**Causa:** IndexedDB usa un solo record `project`; ogni scheda conserva una propria copia del documento e scrive il checkpoint senza confronto di revisione della bozza. La revisione del file applicato protegge l'applicazione al progetto, ma non queste scritture locali. Il messaggio `world-draft` viene pubblicato, mentre il gestore del World Maker ascolta solo `dungeons`.

**Correzione:** una sessione di editing condivisa con revisione della bozza e gestione esplicita dei conflitti. Come prima protezione, una sola scheda scrivente per progetto, con le altre in lettura. Se si permettono bozze indipendenti, assegnare loro identità diverse e una scelta di recupero: non farle scrivere sullo stesso record.

Riferimenti: [storage](../client/editors/world/world-editor-storage.ts), [pubblicazione e ricezione messaggi](../client/editors/world/world-maker.ts), righe 178–199 e 1070.

### 2. P2 — Un aggiornamento dell'istanza può cambiarne involontariamente la quota

**Riproduzione:** asset senza `baseElevation` esplicita su terreno a quota 1. Il runtime lo colloca correttamente a quota 1; l'ispettore mostra 0. Cambiare soltanto la base per l'ordine di disegno e premere Aggiorna salva `baseElevation: 0`.

**Causa:** la lettura dell'ispettore usa `e.baseElevation ?? e.elevation ?? 0`, mentre il mondo ricava la base implicita dal terreno. Il salvataggio rende sempre esplicita la quota del campo.

**Correzione:** distinguere `Eredita dal terreno · quota effettiva 1` da una quota impostata manualmente. Cambiare una proprietà estranea alla quota deve conservare l'ereditarietà.

Riferimento: [ispettore e aggiornamento selezione](../client/editors/world/world-maker.ts), righe 383 e 798–806.

### 3. P2 — La creazione A/B ignora la quota attiva

**Riproduzione:** impostare quota attiva 1 e creare un collegamento A ↔ B. Il documento salva gli estremi a quota 0, tramite il valore predefinito dei campi mancanti.

**Causa:** lo stato del posizionamento conserva mappa e coordinate del primo estremo, ma non la quota; la creazione non assegna `entryElevation` e `arrivalElevation`.

**Correzione:** acquisire separatamente mappa, posizione e quota al click su A e al click su B. Mostrare sempre il riepilogo dei due estremi durante il posizionamento.

Riferimento: [posizionamento warp](../client/editors/world/warp-editor.ts), righe 296–308.

### 4. P2 — Escape non annulla il disegno delle geometrie

**Riproduzione:** avviare un nuovo rialzo, tenere premuto il mouse, trascinare, premere Escape e infine rilasciare. Il rialzo viene comunque aggiunto.

**Causa:** il modulo quote gestisce un proprio `dragging`; Escape annulla soltanto il gesto del World Maker. Il successivo `pointerup` del modulo quote completa la creazione.

**Correzione:** un solo ciclo di vita dei gesti, oppure un contratto comune `commit/cancel` per ogni strumento. Escape, perdita della cattura e cambio di contesto devono poter annullare anche il gesto delle quote.

Riferimenti: [gesto quote](../client/editors/world/elevation-editor.ts), righe 326–366; [Escape principale](../client/editors/world/world-maker.ts), righe 831–839.

### 5. P2 — Azioni immediate cancellano campi ancora in compilazione

**Riproduzione:** digitare un nuovo nome dell'asset senza premere Aggiorna asset, poi cambiare la suddivisione delle collisioni. Il nome torna al valore precedente e quanto digitato scompare.

**Causa:** la suddivisione applica subito una transazione e chiama `refresh()`, che ripopola anche gli altri campi dai dati salvati. Alcuni controlli applicano subito, altri richiedono pulsanti distinti: non esiste uno stato coerente delle modifiche del form.

**Correzione:** buffer di modifica per l'entità ispezionata, con uno stato visibile delle modifiche pendenti e un'azione coerente di applicazione/annullamento. Un aggiornamento della vista non deve riscrivere campi in lavorazione. Le pennellate possono restare transazioni immediate nella bozza.

Riferimento: [suddivisione, refresh e form asset](../client/editors/world/world-maker.ts), righe 119–121 e 261–323.

### 6. P2 — Sottocelle al piano superiore visibili ma non selezionabili

**Riproduzione:** asset con base 0 e una cella con quota relativa +1, senza superfici esplicite in `asset.geometry`. La parte superiore è considerata visibile dal renderer; con quota attiva 1, il click non seleziona l'istanza.

**Causa:** `assetVisible()` comprende le quote delle celle; il filtro di selezione controlla soltanto la base e le superfici esplicite della geometria. I due percorsi usano rappresentazioni diverse dello stesso asset.

**Correzione:** rendere comune la geometria effettiva usata per visualizzazione, selezione e controlli, includendo le superfici derivate dalle sottocelle. Il filtro della quota va applicato allo stesso risultato.

Riferimenti: [selezione](../client/editors/world/world-maker.ts), righe 434–437; [visibilità e disegno asset](../client/editors/world/elevation-visibility.ts), righe 36–57.

### 7. P2 — La validazione dei warp non è coerente fra quote

Riprodotti tre casi:

- Due ingressi coincidenti a quota 1 non vengono segnalati come sovrapposti.
- Due ingressi alle stesse coordinate ma su quote diverse possono essere segnalati come sovrapposti.
- Una coppia di ritorno con coordinate corrette e quote incoerenti supera il controllo di coerenza del ritorno.

**Causa:** il controllo di sovrapposizione passa ad `atWarp()` una posizione senza quota, interpretata come quota 0. Il confronto con il ritorno verifica coordinate e dimensioni, ma non le quote.

**Correzione:** confrontare le aree di attivazione alla stessa quota e controllare anche lo scambio delle quote nella coppia A/B. Valutare l'intera estensione dei passaggi, oltre all'ancora.

Riferimento: [validazione warp](../shared/world-validation.ts), righe 98–120.

## Proposta UX

### Struttura dell'editor

Usare pannelli agganciabili, ridimensionabili, richiudibili e raggruppabili in schede. Consentire di staccare un pannello come opzione avanzata; evitare una finestra indipendente per ogni funzione. Salvare il layout e offrire Ripristina layout. Le attuali colonne hanno larghezze CSS prefissate e gli editor ingranditi usano finestre modali: non c'è ancora un sistema comune di pannelli.

Disposizione iniziale:

| Zona | Contenuto |
| --- | --- |
| Barra superiore | Progetto, mappa attiva, quota attiva, strumento, undo/redo e stato del salvataggio |
| Sinistra | Schede Esplora e Libreria; ricerca; struttura delle mappe e degli oggetti |
| Centro | Vista del mondo; schede per mondo, interni e lavori sul dungeon; modalità isolata per l'asset |
| Destra | Un solo ispettore contestuale dell'elemento selezionato |
| Fascia inferiore richiudibile | Problemi, risultati di ricerca e messaggi delle operazioni |

L'Esplora dovrebbe permettere di trovare mappe, dungeon, NPC, zone, passaggi e istanze senza doverli colpire sulla mappa. Quote e filtri di visibilità devono essere chiari anche quando un elemento è nascosto. Nascondere e bloccare la selezione sono operazioni diverse e meritano controlli distinti.

### Regole di interazione

1. **Selezionare non cambia lo strumento in piazzamento.** Il click su un'istanza apre le sue proprietà; Modifica definizione apre l'asset in una scheda dedicata. Tornando alla mappa si recupera il contesto precedente.
2. **Istanza e definizione devono essere riconoscibili.** Esporre Solo questa copia, Modifica definizione e Crea variante. Per le modifiche condivise mostrare quante istanze e quali dungeon saranno interessati.
3. **Una proprietà ha un solo posto principale.** Le azioni contestuali possono portare all'ispettore, senza creare copie dello stesso comando in pannelli lontani.
4. **Stessa semantica per tutti i gesti.** Escape annulla il gesto; undo annulla la transazione conclusa; il trascinamento usa una soglia per evitare spostamenti involontari. Sui contenuti sovrapposti offrire scelta dell'elemento o ciclo di selezione.
5. **Le opzioni avanzate compaiono quando servono.** Per l'asset separare Aspetto, Collisioni e quote, Generazione; per le zone separare Ambiente, Regole, Popolazione e Missioni.

### Flussi da semplificare

- **Scala:** scegliere quota A, quota B e direzione; anteprima sulla mappa con estremi raggiungibili evidenziati; un gesto per piazzare. La grafica deve essere una proprietà del passaggio.
- **Ponte:** definire percorso e quota; mostrare pavimento superiore e passaggio sottostante, con un'anteprima del percorso del personaggio. Le sottocelle restano disponibili nell'editor avanzato.
- **Warp:** click A, navigazione alla mappa B, click B. Riepilogo persistente con nomi delle mappe, coordinate, quote e direzione; modifica dei due lati nello stesso ispettore.
- **NPC:** piazzamento del modello dalla Libreria; proprietà locali nell'ispettore; modifica del modello visuale in scheda separata. I collegamenti al dialogo e alla missione devono avere nomi comprensibili e accesso diretto.
- **Zone e biomi:** mostrare al cursore i valori effettivi e la zona che determina ciascun valore. Le priorità per proprietà sono corrette come modello, ma difficili da dedurre da sole osservando le aree sovrapposte.
- **Dungeon:** mantenere World Maker e Dungeon Maker come viste specializzate della stessa sessione di progetto. Prima di incorporarli nella stessa interfaccia, risolvere revisione delle bozze e cataloghi condivisi.

### Missioni: limite dell'editor attuale

Le missioni e i dialoghi sono definiti nel codice in `shared/narrative.ts`. L'interfaccia collega una zona a una missione di esplorazione già esistente e un NPC a un dialogo già esistente; non offre un authoring generale di missioni, obiettivi, condizioni e ricompense. Va considerata una funzione ulteriore, non una semplice riorganizzazione dei pannelli attuali.

Un futuro editor Missioni può aprirsi come scheda con proprietà e collegamenti a NPC/aree. Conviene partire da un flusso guidato per missioni semplici, aggiungendo una vista a grafo quando condizioni e diramazioni la rendono utile.

### Diagnostica utile all'autore

Trasformare gli attuali messaggi testuali in problemi con gravità, mappa, quota e riferimento all'elemento. Il click su un problema deve aprire la mappa corretta, rendere visibile la quota e selezionare il contenuto. Distinguere dati non validi, avvisi di gameplay e suggerimenti: una mappa isolata o una superficie intenzionalmente inaccessibile non devono diventare automaticamente errori bloccanti.

Per le modifiche globali agli asset, mostrare l'impatto prima dell'applicazione: nuovi ingombri, collisioni e istanze interessate. Aggiungere una prova rapida del movimento fra due punti scelti permette di verificare scale e ponti con il raggio effettivo del personaggio.

## Ordine consigliato

1. Correggere i sette difetti e aggiungere copertura dei casi riprodotti.
2. Unificare stato della selezione, ciclo di vita dei gesti, modifiche pendenti dei form e revisione della bozza. Conservare la distinzione fra quote del terreno, geometria e quote relative degli asset, presentandone però un risultato effettivo coerente.
3. Introdurre Esplora, ispettore unico, schede di lavoro e pannelli ridimensionabili, con un layout iniziale semplice.
4. Migliorare anteprime di scale/ponti, diagnostica navigabile e impatto delle modifiche condivise.
5. Estendere l'authoring di missioni e dialoghi.

Non serve sostituire subito Canvas o il modello del mondo. La separazione già presente fra rendering, cronologia, storage e dati condivisi è una base utile; serve un coordinamento comune fra gli strumenti.

## Verifiche e limiti

- `npm run typecheck`: superato.
- 46 test esistenti superati: `world-authoring`, `world-physics`, `world-tiles`, `world-library`, `warps`.
- Riproduzioni browser dei difetti 1–6 su documenti temporanei; nessun errore JavaScript nelle prove completate.
- Riproduzioni dirette del validatore per i tre casi del difetto 7.
- Il documento attuale contiene 87 asset, 225 istanze, 7 interni, 35 warp, 5 zone e 29 NPC: il validatore esistente restituisce zero problemi. Questo risultato non copre le lacune qui riprodotte.
- Studio temporaneo e browser chiusi al termine; nessun server lasciato attivo da questa analisi.
- Non è una verifica esaustiva di ogni combinazione di combattimento, missione o dungeon; le proposte di layout richiedono una successiva prova con flussi reali di authoring.
