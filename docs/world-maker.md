# World Maker locale

### Transizioni del meteo

Il ciclo di maltempo resta condiviso; la temperatura locale sceglie il rapporto tra pioggia e neve. Sulla scala normalizzata del maker, sotto **0,22** prevale la neve, sopra **0,34** la pioggia; nella fascia intermedia convivono gocce e fiocchi. Questi valori non sono gradi Celsius. Le zone climatiche graduali restano utili per il territorio, ma anche un confine netto viene accompagnato da una transizione visiva.

La temperatura percepita e la miscela di precipitazioni cambiano progressivamente. Attraversando ripetutamente un confine caldo/freddo, la transizione segue il nuovo obiettivo a partire dallo stato corrente, senza ripartire da zero, accodare animazioni o far lampeggiare il cielo. I passaggi molto brevi vengono attenuati; una permanenza nella nuova zona porta gradualmente al suo meteo, indicativamente in 8–12 secondi.

La copertura del cielo è indipendente dalle particelle: arriva prima della pioggia e si dissolve più lentamente quando il maltempo finisce. Durante la neve rimane un filtro coperto più leggero e grigio, anziché sostituire immediatamente il filtro della pioggia con una velatura chiara. Il cambiamento della luce si distribuisce su circa 15–20 secondi, con un assestamento più lungo quando cambia anche il tipo di precipitazione. Negli interni e durante il passaggio tra mappe le precipitazioni vengono escluse; tornando all'aperto ricompaiono gradualmente.

### Ripresa della musica e cerchio dei dialoghi

La musica dei punti sonori e delle zone riprende dal punto raggiunto quando torni ad ascoltarla. La posizione è conservata nel client durante la sessione della pagina, separatamente per ogni giocatore: non è sincronizzata dal server e si azzera ricaricando la pagina. Fuori dal raggio il punto sonoro resta fermo e non continua a scaricare o riprodurre la traccia. Nella scheda del punto sonoro, attiva **Ricomincia la canzone a ogni ingresso** solo se vuoi ripartire dall'inizio, poi premi **Aggiorna** e **Applica al gioco**.

Nel **laboratorio NPC**, disattiva **Mostra cerchio attorno all’NPC** nella sezione **Dialogo di interazione**, poi premi **Salva catalogo NPC**. Per cambiare una singola istanza selezionala sulla mappa, scegli **Cerchio dialogo → Nascondi** e premi **Aggiorna**, quindi **Applica al gioco**. **Eredita dal modello NPC** usa l'impostazione del laboratorio. Il dialogo e l'indicatore sopra la testa restano disponibili: questa opzione nasconde solo il cerchio.

### NPC con solo idle

Gli NPC possono usare il solo spritesheet **idle**, senza animazione **moving**. Nel laboratorio premi **Usa solo idle · rimuovi moving**: conserva l'idle già configurato oppure lo crea dal moving, poi elimina il moving. Seleziona **idle**, importa il tuo spritesheet e imposta colonne, righe e **Ripeti animazione**. Per un foglio senza direzioni disattiva **4 direzioni, una per riga**; quando è attivo servono quattro righe. Salva con **Salva catalogo NPC**.

Puoi aggiungere nuovamente **moving** da **Nuova animazione → moving → Aggiungi animazione**. Il gioco usa l'idle anche quando un NPC senza moving si sposta. La scelta riguarda la grafica: per tenerlo fermo sulla mappa imposta **Raggio di movimento** a **0** nelle proprietà della singola istanza. Gli NPC con il solo moving restano supportati e, quando fermi, mostrano il primo frame della direzione attuale.

### Nuovi NPC, fumetti e conversazioni

Nel **laboratorio visuale NPC**, apri **＋ Nuovo NPC**, inserisci ID e nome e scegli il comportamento di base. Il personaggio neutro predefinito si muove vicino al punto di origine e parte senza missioni, fumetti o dialoghi. Importa gli sprite o personalizza la grafica nella scheda, poi salva il catalogo.

**Fumetti automatici** e **Dialogo di interazione** sono indipendenti: puoi ereditare dal modello, disattivarli o personalizzarli. Nei fumetti imposta una prima frase e, facoltativamente, altre frasi da alternare, una per riga. I tempi e le distanze restano quelli dei fumetti del gioco.

Nel dialogo personalizzato aggiungi le frasi dell'NPC e le risposte del giocatore. Per ogni risposta scegli una frase successiva oppure **Chiudi dialogo**. Imposta la frase iniziale e usa **Prova il dialogo** per attraversare le risposte prima di salvare. Sono ammessi fino a 64 frasi, con 8 risposte ciascuna; rimuovendo una frase, le risposte che la raggiungevano diventano chiusure del dialogo. Queste conversazioni sono libere, senza missioni o ricompense. **Usa un dialogo esistente** conserva invece il funzionamento dei dialoghi di missione e del negozio già disponibili.

Le modifiche vengono salvate con **Salva catalogo NPC** e valgono per tutte le istanze che ereditano quel modello. Se un personaggio già piazzato ha un dialogo assegnato esplicitamente, selezionalo sulla mappa e scegli **Eredita dal modello NPC** nel campo Dialogo, poi premi **Aggiorna** e **Applica al gioco**. **Nessun dialogo** disabilita l'interazione solo su quella istanza. Anche duplicando un NPC i contenuti personalizzati vengono copiati indipendentemente.

### Duplicare un NPC

Apri **NPC · laboratorio visuale**, scegli un personaggio o un mob e premi **Duplica come nuovo NPC**. Assegna un ID univoco (lettere minuscole, numeri e trattini), poi personalizza nome, gruppo facoltativo, sprite e animazioni. La copia ha una skin indipendente: le modifiche alla sua grafica non cambiano l'originale. Puoi duplicare anche una copia.

La scheda mostra l'ID della variante e il modello da cui eredita il comportamento. Il gruppo serve a organizzare il catalogo; non modifica l'IA. Movimento, combattimento e interazioni restano quelli del modello originale. Nome, dialogo e parametri della singola istanza si impostano selezionando il personaggio sulla mappa.

Premi **Salva catalogo NPC**: la nuova voce diventa disponibile nel menu **NPC manuale**, con gruppo e modello di origine. Sceglila e usa **Spawn NPC** per piazzarla, quindi **Applica al gioco** per salvare i piazzamenti. La stessa variante può essere usata da più personaggi e compare anche nelle proprietà NPC del Dungeon Maker. Ricarica il gioco e riavvia il server per caricare il catalogo aggiornato.

I modelli e le skin vengono salvati in `shared/actor-catalog.json`; le istanze nel documento del mondo conservano il riferimento alla variante. Per trasferire il progetto completo copia anche quel catalogo e i relativi file in `public/actor-assets`: l'archivio del World Maker contiene i piazzamenti, mentre il catalogo attori resta una risorsa separata.

In **Mappe**, seleziona una mappa interna e premi **Elimina completamente questa
mappa interna**. Dopo conferma vengono rimossi l’intera mappa con terreno, oggetti,
NPC, zone e dungeon, e tutti i passaggi da e verso quella mappa, anche dagli altri
interni. I dungeon contenuti non ricompaiono automaticamente nel mondo principale.
La cancellazione supporta Undo e diventa effettiva nel progetto con **Applica al gioco**.
Nel gioco già aperto, **Applica al gioco** pubblica la nuova versione senza riavvio. Il mondo principale
non può essere eliminato. Un edificio disegnato all’esterno è un oggetto separato:
si rimuove selezionandolo sulla mappa del mondo, senza eliminare il suo asset condiviso.

Nel catalogo ingrandito, **Mantieni aperto** affianca il catalogo alla scheda proprietà:
selezionare un asset non lo chiude. **Torna a finestra singola** ripristina la selezione
con chiusura automatica. Il catalogo fissato e la scheda ingrandita vengono ricordati
anche dopo un ricaricamento. **Ripristina layout** torna alla disposizione iniziale.

La scheda asset mostra il file immagine e gli altri asset che lo condividono.
**Sostituisci immagine interna · dal catalogo** apre la ricerca con miniature delle
immagini già importate: scegli un asset e premi **Usa immagine**. **Sostituisci immagine
esterna · da file** apre invece il file system. Entrambe cambiano solo l’immagine
dell’asset corrente, anche quando è una variante: gruppo, dimensioni, collisioni,
trasparenza e istanze restano conservati. La scelta interna riusa il file esistente,
senza duplicare l’asset sorgente, e la sostituzione supporta Undo.

**Rimuovi dal catalogo · conserva file** elimina solo la definizione e le sue copie
manuali, mantenendo il file per gli altri asset. Supporta Undo e si salva con
**Applica al gioco**; **Sincronizza cartelle** può reimportare il file rimasto.
Il blocco dell’eliminazione definitiva indica i nomi degli asset o aspetti personaggio
che usano ancora la stessa immagine.

**Rimuovi tutte le istanze** rimuove i posizionamenti dell’asset selezionato nel mondo
e negli interni, conservando catalogo e immagine. La modifica è annullabile e si salva
con **Applica al gioco**; le regole di generazione restano invariate.

**Elimina asset definitivamente** richiede conferma, applica la bozza corrente e
rimuove catalogo, istanze e file immagine da `public/world-assets/`. L’operazione
non è annullabile con Undo. Viene bloccata se il file è condiviso con altri asset
o personaggi, se l’asset è usato nei dungeon, da varianti o dai bordi automatici.
Lo storico Git dei file già committati resta disponibile.

## Area di lavoro e selezione

Le due colonne laterali si ridimensionano trascinando il separatore; con il separatore
selezionato funzionano anche le frecce della tastiera. La scheda a destra può essere
ingrandita con **⤢**, chiusa con **×** e riaperta selezionando un oggetto.
**Ripristina layout** recupera le dimensioni iniziali.

Il box **Terreno** riunisce materiale e **Livello terreno**, con pulsanti **− / ＋**.
**Mantieni livello** cambia soltanto il materiale. Il terreno ordinario sale di un
solo livello per volta: dipingere quota 2 su terreno 0 viene escluso con un messaggio;
sono consentiti 0 → 1 e poi 1 → 2. Si può abbassare direttamente il terreno a quota 0
anche partendo da quota 2 o superiore. Ponti, scale e geometrie configurate dentro un asset
mantengono le loro quote specifiche. Le vecchie mappe non vengono modificate da questa
regola di authoring.

In **Seleziona**, il click usa il punto preciso, l'ordine di disegno e la trasparenza
dell'immagine, comprese le sottocelle rialzate. La scheda dell'elemento appare subito
a destra. **Alt + click** passa agli altri elementi sovrapposti. Un piccolo movimento
del mouse non sposta l'oggetto; Escape annulla anche il disegno di rialzi e ponti.
Le proprietà della copia sono separate dalla definizione condivisa: **Crea variante
per questa copia** permette di modificarne il modello senza cambiare le altre istanze.
La quota base vuota eredita il terreno e mostra il valore effettivo nel campo.
Le zone hanno precedenza sui terreni rialzati e sui bordi automatici quando si clicca:
le geometrie del terreno sono selezionate solo se non ci sono altri elementi nel punto.
Le scale restano selezionabili con un clic in **Seleziona** anche dentro una zona:
hanno precedenza sulla zona e aprono le proprietà per modificarle o eliminarle.
Per selezionare la zona sotto una scala usa **Seleziona → Alt + clic**.
Le zone non appartengono a una quota e restano visibili e selezionabili anche filtrando i piani.

Tieni premuto il sinistro e trascina per disegnare un rettangolo di selezione: include
gli oggetti e gli NPC sulle quote visibili, escludendo terreni, geometrie, zone e passaggi.
Trascina un oggetto del gruppo per spostare insieme la selezione; **Canc** o **Rimuovi**
eliminano il gruppo. Spostamento e rimozione supportano **Undo**. **Escape** annulla
il trascinamento in corso.

**Esplora** elenca mappe, asset, NPC, zone, passaggi, dungeon e geometrie con ricerca.
Selezionando una voce si centra la mappa e si apre la scheda relativa. I problemi
identificabili del controllo progetto sono cliccabili e aprono mappa, quota e scheda.

I campi non ancora confermati restano in compilazione durante gli aggiornamenti della
vista e sono evidenziati. **Salva scheda asset** conferma insieme aspetto, trasformazione
dell'immagine, trasparenza e regole di generazione in una sola operazione annullabile.
La bozza condivisa ha una revisione locale: se due schede
modificano la stessa bozza, una scrittura obsoleta viene rifiutata senza sovrascrivere
l'altra. La versione in conflitto rimane in memoria, esportabile; **Recupera bozza
condivisa** ricarica invece l'ultima versione salvata.

Per rialzi, ponti, collisioni parziali e scale vedere
[Quote, terreni sopraelevati e scale](livelli-terreno-scale.md).

Avvia `npm run world:studio` e apri `http://127.0.0.1:3002/world-maker.html`. `WORLD_STUDIO_PORT` cambia la porta. L’editor è un processo locale separato dal server del gioco. La pubblicazione usa un endpoint del gioco accessibile soltanto da loopback con un segreto presente nel lock locale dei salvataggi.

Lo stesso Studio include il Dungeon Maker: **Dungeon Maker ↗** apre una scheda dedicata, mentre **Modifica dungeon ↗** apre il dungeon selezionato. `npm run dungeon:studio` è un accesso allo stesso World Studio (`STUDIO_PORT` resta supportata). Catalogo installato, backup e API locali sono condivisi nello stesso processo.

**Applica al gioco** valida e salva con backup la mappa e la pubblica sul server locale attivo. Se il gioco usa `DATA_FILE`, avvia lo Studio con lo stesso `DATA_FILE`; `WORLD_FILE` permette di scegliere un documento alternativo sia per il gioco sia per lo Studio. A gioco spento salva il progetto per il prossimo avvio. Dopo aver installato questa modifica serve una build iniziale; le successive modifiche al documento della mappa non richiedono build o riavvio. Il client carica la mappa da `/api/world.js` e riceve gli aggiornamenti via WebSocket prima degli snapshot della nuova versione. `Ctrl+C` chiude lo Studio, compresi i suoi socket.

All'apertura e con **Ricarica progetto**, la base è sempre il JSON applicato. Una vecchia bozza del browser non sostituisce automaticamente né il documento né la revisione del server: se esiste, è disponibile con **Ripristina bozza precedente** e diventa pubblica solo premendo **Applica al gioco**. Ogni applicazione riuscita aggiorna la base dello Studio, permettendo di continuare a modificare senza ricaricare o esportare.

Alla pubblicazione si controlla solo la geometria nella posizione occupata dal giocatore. Se resta calpestabile alla stessa quota, X/Y e quota restano invariati. Se la quota cambia verso un valore non negativo, si aggiorna la quota mantenendo X/Y; se diventa negativa o compare un ostacolo, il giocatore torna allo spawn della nuova mappa. Cambi di bioma, grafica o NPC non causano spostamenti da soli. Lo spawn deve essere calpestabile e non negativo. Gli interni vengono aggiornati allo stesso modo; eliminando un interno, i suoi occupanti tornano allo spawn del mondo principale. Le posizioni salvate e i checkpoint di ritorno vengono aggiornati anche per gli account offline. Solo i giocatori riposizionati ricevono una nuova epoch e il reset del movimento; gli altri ricevono la mappa aggiornata conservando input, camera e stato del client. La pagina e la connessione non vengono ricaricate.

NPC e oggetti transitori della mappa vengono rigenerati alla pubblicazione; gli incontri boss con definizioni e posizionamenti invariati vengono conservati. La modifica delle definizioni del catalogo nel Dungeon Maker o degli attori rimane un'operazione offline: la pubblicazione live riguarda il documento del World Studio, compresi posizionamenti dungeon, interni e passaggi.

## Asset e griglia

**Dimensione dell’oggetto e suddivisione delle celle sono indipendenti**, per tutti
i PNG/SVG del catalogo, compresi i bordi automatici. **Larghezza/Altezza oggetto · tile**
cambiano l’ingombro. **Suddivisione di ogni tile** cambia solo la precisione delle
collisioni e della visibilità: scegli 1×1, 2×2, 4×4 o 8×8 nel pannello destro.
Un PNG grande 1×1 tile a 4×4 ha 16 sottocelle da ¼ di tile (12 unità), mantenendo
la stessa immagine, scala, posizione e geometria delle quote.

La scelta si applica subito nella bozza ed è annullabile. Le sottocelle ereditano
le proprietà delle celle originali; poi dipingi i singoli quadratini come prima.
Riducendo la suddivisione, le celle riunite conservano eventuali blocchi, nascondigli
e trasparenze. **Applica al gioco** salva le modifiche; la suddivisione è inclusa
anche nell’export del mondo e viene condivisa con Dungeon Maker e client.

**Piano delle sottocelle che dipingi** assegna alle celle una quota relativa alla
base dell’asset: **0**, **+1**, **−1** oppure un intero personalizzato. Scegli
**Calpestabile** e **+1**, poi dipingi solo la parte del bordo che deve sostenere
il PG sul piano superiore. Per i cliff-grid la base è il terreno inferiore.
**Mantieni quota esistente** permette di cambiare le altre proprietà senza spostare
il pavimento. Scale e passaggi collegano i piani; una cella rialzata non crea una salita
automatica. Il filtro **Livelli visibili** mostra anche queste sottocelle alla loro
quota. Per ridurre la suddivisione devi prima uniformare eventuali quote diverse
nelle celle che verranno riunite.

Per un PNG che deve collegare due piani usa **Usa questo asset come scala / passaggio**,
imposta le quote relative e l'asse, poi **Aggiorna selezione** e piazza l'asset.
Per un passaggio sul terreno usa **Scala / passaggio · sali e scendi** con grafica
**Passaggio · conserva terreno / PNG**. La scala in pietra è una scelta grafica;
le scale automatiche dei rialzi si attivano solo spuntando l'apposita casella.

Importa uno o più PNG/SVG. Le immagini vengono conservate in `public/world-assets` con un nome derivato dal contenuto: importare la stessa immagine non crea una seconda copia. Il catalogo può contenere più definizioni della stessa immagine, con scale e comportamenti diversi.

Le dimensioni sono in quadratini, anche frazionarie, da 0,25 a 32 per asse. **Mantieni proporzioni** collega larghezza e altezza; disattivalo per dimensionarle separatamente. Le celle occupate sono arrotondate per eccesso. Nell’anteprima ogni cella ha proprietà indipendenti:

- Movimento: calpestabile oppure bloccante. Il terreno sottostante mantiene le sue collisioni: per un ponte sopra acqua va definito anche il percorso calpestabile.
- Visibilità: normale, nascondiglio oppure trasparente al passaggio. Il nascondiglio usa la stessa logica autorevole dei cespugli; la trasparenza non imposta il player come nascosto.
- **Nascondiglio + trasparenza** combina i due comportamenti. La trasparenza interessa solo le celle marcate: le altre parti dell’immagine conservano la propria opacità. **Opacità residua**, **Sfumatura** (in celle) e **Transizione** (millisecondi) controllano intensità, bordo graduale e ingresso/uscita. **Anteprima trasparenza parziale** mostra la maschera sull’immagine nell’ispettore. La sfumatura resta dentro le celle trasparenti, senza rendere trasparente il tronco o le altre parti opache.

Scegli le due proprietà e dipingi sulle celle, oppure applicale a tutto l’asset. Ridimensionare la griglia conserva le annotazioni delle celle ancora presenti; quelle aggiunte sono calpestabili e normali. **Sfondo** disegna prima degli attori. **Oggetto** si ordina rispetto agli attori tramite la base verticale della griglia, da 0 (alto) a 1 (basso).

**Immagine nella griglia** modifica soltanto il disegno: **Spostamento X / Y** trasla l’immagine in celle (da −32 a +32), **Scala immagine %** la ingrandisce o riduce mantenendo le proporzioni (10–800%). **Aggiorna immagine** salva i valori; **Ripristina** torna alla posizione iniziale e al 100%. Attiva **Sposta immagine con il sinistro** per trascinare direttamente il disegno nell’anteprima, anche nella vista ingrandita; disattivalo per dipingere le proprietà delle celle. I gesti supportano undo/redo e si annullano con Escape. Le parti che sbordano ereditano la trasparenza della cella più vicina sul bordo, comprese le celle normali; collisioni e nascondigli rimangono nella griglia. Le trasformazioni valgono per tutte le istanze, anche nel Dungeon Maker, nel playtest e nel client, e si conservano in salvataggi ed esportazioni.

La vista delle celle ha uno zoom indipendente dalla scala dell’asset: rotella attorno al cursore, pulsanti **− / ＋**, **Adatta** per inquadrare griglia e immagine intere, compresi gli sbordi. Spazio + trascina, tasto centrale o destro spostano la vista. **Ingrandisci** apre una vista ampia con gli stessi controlli di movimento, visibilità e anteprima; **Chiudi**, **Riduci** o Escape riportano la vista nell’ispettore. Le celle modificate restano annullabili. **Aggiorna sfumatura** salva i parametri anche dalla vista ingrandita.

**Gruppo catalogo** organizza gli asset in gruppi a un solo livello, indipendenti dalla categoria del generatore. Inserisci un nome o scegli un gruppo già esistente; lascia vuoto per **Senza gruppo**. Le nuove immagini vanno in **Importati**. Ogni gruppo mostra il numero di asset e si apre/chiude dalla sua intestazione; **Espandi tutti / Comprimi tutti** agiscono sull’elenco. La scelta resta nel browser. La ricerca comprende nome, gruppo e categoria e apre temporaneamente i gruppi con risultati. I gruppi chiusi non creano miniature; quelli aperti mostrano 40 asset per volta, con **Mostra altri**.

Aggiornare un asset aggiorna tutte le sue istanze. **Verifica ingombri e riferimenti** segnala, tra l’altro, spawn bloccati e asset dentro dungeon. La validazione è ripetuta sul server locale prima dell’applicazione.

**Ingrandisci catalogo** apre solo il catalogo asset in una finestra ampia, con ricerca,
gruppi e miniature su più colonne. **Chiudi** o Escape ripristinano il pannello laterale;
selezionare un asset chiude la finestra e apre la sua scheda per modificarlo o piazzarlo.

Per usare PNG diversi come alternative dello stesso oggetto, seleziona l'asset principale
(per esempio **Cespuglio**) e premi **Crea variante di questo asset**. La copia conserva
dimensioni, celle e proprietà; **Sostituisci immagine** assegna il nuovo PNG. Per un asset
già importato, scegli il principale in **Gruppo varianti** e premi **Salva scheda asset**.
Il catalogo riunisce principale e varianti sotto il nome del principale.

Il generatore sceglie con uguale probabilità tra principale e varianti e usa le regole
del principale, contando una sola volta la frequenza del gruppo. Dimensioni, collisioni,
nascondigli e trasparenze rimangono specifici di ogni variante. La scelta è deterministica
per coordinate e seed, anche dopo salvataggio, esportazione e ricaricamento. I cespugli
PNG su erba e terreno cespuglio usano il gruppo; **Usa bush JS** mantiene il disegno canvas.
Piazzando il principale con **Disegna varianti casuali del gruppo**, anche il pennello
sceglie fra i membri. Selezionando una variante si piazza esattamente quella; disattivando
la casella si piazza esattamente il principale. Le copie manuali già presenti conservano
il proprio asset. Per rimuovere un principale, rendi prima autonome le sue varianti.

**Aspetto** sceglie l’immagine importata oppure il disegno animato di un braciere/fuoco da campo. Questi due disegni conservano fiamme, bagliore e scintille originali, scalano con l’asset e funzionano sia nel gioco sia nell’editor. La scelta è salvata nei dati dell’asset e non dipende dal suo nome o dalla posizione. Le vecchie bozze che referenziano le immagini iniziali di fuoco e braciere ricevono lo stesso disegno animato; scegli esplicitamente **Immagine importata** per mantenerle statiche.

Il recupero delle vecchie animazioni riconosce anche le copie delle immagini originali rinominate con il loro hash durante esportazione/importazione. La lettura del documento rende esplicito l’aspetto animato, così le esportazioni successive conservano la scelta anche cambiando il percorso dell’immagine.

PNG: massimo 5 MB, 8192 pixel per asse e 32 milioni di pixel totali. SVG: massimo 5 MB, forme e riferimenti interni; script, animazioni SVG, oggetti HTML e risorse esterne sono esclusi. Il gioco decodifica le immagini fuori dal ciclo di rendering, rasterizza gli SVG e limita la cache a 256 bitmap / 16 milioni di pixel, con al massimo otto caricamenti contemporanei.

## Disegnare il mondo

Il mondo non ha larghezza o altezza iniziali. La vista esplora coordinate positive e negative; **Vai a…** raggiunge una posizione in quadratini. La rotella ingrandisce attorno al cursore. Spazio + trascina, tasto centrale o tasto destro spostano la vista. A zoom lontano la vista usa campionamento del terreno per contenere il lavoro per fotogramma.

- **Terreno**: pennello continuo con raggio. Le celle dipinte restano manuali e disabilitano gli asset procedurali su quelle celle.
- **Asset**: piazzamento singolo. Ctrl + trascina, oppure **Asset con pennello continuo**, usa raggio e densità del pennello. La distanza minima evita accumuli; i passaggi veloci interpolano le celle attraversate.
- **Cancella**: rimuove asset manuali e NPC nell’area e impedisce che gli asset generati ricompaiano. Conserva il terreno dipinto.
- **Procedurale**: elimina l’intervento sul terreno e il blocco alla rigenerazione, lasciando nuovamente lavorare il generatore. Non rimuove le istanze manuali.
- **Seleziona**: un click seleziona asset, NPC, dungeon o zona; poi tieni premuto il sinistro sullo stesso elemento per trascinarlo mantenendo il punto di presa, anche per zone rettangolari e circolari. Il gesto si annulla con Escape ed è una sola modifica nella cronologia. Trascinare un asset procedurale lo converte in un’istanza manuale e ne impedisce la ricomparsa nella posizione originale. Il destro sposta sempre la vista, anche sopra un oggetto; valgono anche Spazio + trascina e tasto centrale. Le zone possono essere selezionate anche dal loro elenco.
- **Spawn player**: imposta il centro dello spawn globale. Chi rientra con una posizione salvata diventata bloccata viene riportato a uno spawn libero, conservando progressi e salute.

Una pennellata è una singola operazione annullabile. Ctrl+Z annulla; Ctrl+Shift+Z ripete. La cronologia è limitata sia nel numero di transazioni sia nella memoria. Le proprietà di collisione e visibilità possono essere mostrate sopra la mappa.

Il raggio del pennello è espresso in celle del mondo, indipendentemente dallo zoom: raggio 16 copre circa 800 celle per impronta. Il contatore sotto la mappa mostra quante celle sono state modificate. I tratti lunghi vengono elaborati a gruppi con un budget di lavoro per fotogramma, mantenendo l’interpolazione e un’unica operazione di undo. La palette mostra gli asset a gruppi e riusa il DOM durante le pennellate.

## Generazione e clima

Un asset può essere solo manuale oppure disponibile anche al generatore. Definisci categoria, terreni ammessi, temperatura, umidità, frequenza e distanza minima. Le categorie sono identificatori estensibili, ad esempio `vegetation`, `water` o `decoration`; l’idoneità concreta deriva dai terreni e dagli intervalli climatici scelti.

Temperatura e umidità sono normalizzate tra 0 e 1. Le regole vengono controllate su **ogni cella dell’ingombro**, non solo sull’origine. I piazzamenti manuali, le celle escluse, gli interni dei dungeon, i loro accessi e gli ingressi arena riservano lo spazio.

La frequenza è la probabilità/peso di proposta negli slot della propria fascia di dimensioni. Dimensioni e distanza determinano fasce da 1 a 64 celle; introdurre un asset grande non cambia la griglia di tutta la vegetazione piccola. Le proposte tra fasce risolvono sovrapposizioni e distanze tramite priorità determinate da coordinate e seed. Nessuna decisione dipende dall’ordine di esplorazione o dai chunk presenti in cache.

Le celle lasciate senza interventi restano procedurali. Le zone possono modificare solo temperatura e/o umidità: la temperatura controlla neve e ghiaccio, mentre l’umidità controlla bioma e fango. Strade manuali e interni dei dungeon mantengono il proprio terreno. Il cespuglio iniziale è una definizione del catalogo usata dal generatore; anche la vecchia tile `bush` usa ora `bush.png` per impostazione predefinita.

Nel pennello terreno, **Usa bush JS** sceglie il disegno canvas per i cespugli dell’erba dipinta o del terreno Cespuglio; senza spunta si usa il PNG. La scelta viene salvata sulle celle dipinte, con annulla/ripeti ed esportazione, e non modifica le altre zone. Sull’erba i cespugli restano sparsi secondo densità, clima, esclusioni e regole del catalogo, mentre gli altri asset procedurali restano soppressi. Cancella rimuove i cespugli generati dall’erba; Procedurale elimina anche la scelta locale.

## Zone, NPC e arene

**Zona** crea un rettangolo trascinando sulla mappa; l’ispettore permette anche cerchi. Le proprietà non impostate sono ereditate. Per ogni proprietà prevale la priorità numerica più alta; a parità prevale l’ID in ordine alfabetico. Una zona climatica non cancella implicitamente la regola PvP di una zona sottostante.

Le zone gestiscono PvP, clima, generazione degli asset e NPC. Il comportamento delle zone senza PvP conserva il tempo di combattimento già previsto dal gioco: chi rientra mentre è ancora marcato in combattimento diventa protetto alla scadenza del tag.

I contorni e le etichette delle zone sono strumenti dell’editor e non vengono disegnati nel gioco o nella minimappa. Gli ingressi arena conservano il segnale visibile necessario per partecipare. Il nome del luogo nella HUD usa la zona alla posizione del giocatore, secondo le priorità, con i nomi di dungeon/bioma come fallback.

Per gli NPC delegati, separa probabilità di spawn, limite per chunk e percentuali dei tipi. Le percentuali sommano a 100 oppure sono tutte a zero. Densità zero, limite zero o tutti i pesi zero escludono gli NPC delegati; quelli manuali rimangono. Le posizioni dei dungeon sono escluse dalla popolazione procedurale; i loro NPC rimangono definiti nel Dungeon Maker.

Gli ingressi arena indicano il profilo `arena-1`, quello attualmente implementato. Puoi creare più ingressi; ciascuna zona ha una coda separata, anche quando porta allo stesso profilo. Nuovi profili richiederanno la relativa implementazione nel sistema delle arene: il formato della zona è già predisposto.

## Dungeon e crocevia

Il catalogo installato è letto dal Dungeon Maker. Il World Maker colloca una sola istanza per dungeon installato, mantenendo gli ID di boss e incontri. Spostare trasla insieme terreno, ingressi, fiamme, regioni, punti di attivazione, NPC, pickup e spawn. Rimuovere dalla mappa disabilita l’istanza e conserva il dungeon nel catalogo; riposizionarlo lo riabilita.

I nuovi dungeon installati nello Studio restano fuori dalla mappa finché non li posizioni qui con lo strumento **Dungeon** e applichi il progetto. Il Dungeon Maker usa lo stesso catalogo asset del mondo, comprese dimensioni, collisioni, nascondigli, trasparenza e aspetti animati; i suoi piazzamenti si spostano insieme al dungeon. Importa e modifica gli asset nel World Maker. Le schede condividono il catalogo della bozza; applicalo prima di installare un dungeon che usa nuovi asset. I cambiamenti del catalogo dungeon vengono riletti senza perdere le modifiche alla bozza del mondo.

Spostare o disabilitare un dungeon ripulisce **soltanto gli stati dei suoi boss**: cooldown di respawn e loot non raccolto di quel dungeon vengono azzerati. Gli altri dungeon e gli account restano conservati. La pulizia viene salvata prima del nuovo mondo, con backup: un’interruzione può lasciare i boss interessati azzerati nel vecchio mondo, che resta caricabile. Per ripristinare stato e posizione insieme, ripristina entrambi i backup a server fermo.

L’aggiornamento di un dungeon dal suo Studio usa la posizione scelta nel mondo e verifica la compatibilità con gli interventi manuali. Rimuovere definitivamente un dungeon dal catalogo ripulisce anche il suo riferimento nel documento del mondo.

Il crocevia iniziale è migrato nel documento: terreno, zona sicura, esclusione NPC, ingresso arena, pietre, bracieri e fuoco sono modificabili. Fuoco e bracieri mantengono il disegno animato originale come aspetto selezionabile del catalogo. Le immagini importate rimangono statiche; il loro formato di animazione generale è distinto dagli aspetti animati già integrati.

## Salvataggi e formato

La bozza usa IndexedDB, separata dal progetto applicato. Ogni applicazione usa una revisione del file per impedire che una finestra sovrascriva gli aggiornamenti di un’altra. **Ricarica progetto** sostituisce la bozza con il progetto sul disco; esporta prima se vuoi conservare entrambe le versioni. Una bozza recuperata da una revisione superata deve essere esportata e riconciliata prima di applicarla.

Il formato 2 conserva il terreno in chunk di 32×32 celle, codificati come intervalli di valori uguali. Le aree uniformi costano pochi numeri, senza un oggetto JSON per cella. Il runtime conserva i chunk codificati e decodifica al massimo 128 chunk recenti; l’editor sostituisce soltanto quelli toccati. Undo/redo conservano le differenze tra chunk entro un budget comune di 24 MB. IndexedDB salva i chunk in record separati e riscrive soltanto quelli cambiati, con salvataggi ravvicinati accorpati. Terreno dell’editor e minimappa hanno cache di rendering, indipendenti dai marker in movimento.

Le bozze e gli archivi del formato 1 vengono convertiti senza perdere terreno o maschere. `node --import tsx scripts/compact-world.ts` converte il file applicato, confronta ogni cella e conserva un backup `.before-chunks-….bak`. Il piccolo file `.format-migration.bak` permette di riconoscere la revisione precedente soltanto quando è cambiata la rappresentazione, e smette di essere valido dopo una modifica dei contenuti. La vecchia bozza IndexedDB viene risalvata automaticamente nel formato a chunk al primo caricamento.

**Esporta** crea un JSON portabile con documento e immagini. I dungeon sono riferimenti al catalogo installato, che va trasferito insieme quando si usa un altro progetto. **Importa** ripristina le immagini nel deposito locale e carica il documento come bozza; non modifica il progetto fino all’applicazione.

Il documento versionato è `shared/custom-world.json`; immagini e catalogo sono distribuiti insieme al client. `shared/world-schema.ts` valida i dati; `shared/world-authoring.ts` gestisce indici e proposte; `shared/world.ts` applica le regole al generatore condiviso. Client, collisioni, proiettili e server autorevole usano le stesse definizioni. L’editor separa presentazione, rendering Canvas, cronologia e storage.

Le modifiche sono sparse e indirizzate per coordinate. I limiti correnti sono budget di importazione/editor, non dimensioni del mondo: 4096 asset, 100.000 istanze manuali, 20 milioni di celle modificate in 100.000 chunk / 2 milioni di intervalli codificati, 10.000 zone, 100.000 NPC manuali, coordinate entro ±10 milioni di celle e richieste di applicazione entro 40 MB. Il formato legacy accetta 500.000 celle prima della conversione. I dati codificati restano nel documento; celle decodificate, proposte procedurali, zone consultate e bitmap hanno cache limitate. Il mondo procedurale non viene materializzato o salvato per intero.

Verifiche: `npm test`, `npm run build`, `npm run test:world-studio`. Per le verifiche complete nel browser, esegui `node --import tsx --test --test-concurrency=1 tests/integration/world-studio.test.ts tests/integration/world-render.test.ts tests/integration/world-large.test.ts tests/integration/terrain-browser.test.ts tests/integration/dungeon-studio.test.ts tests/integration/dungeon-playtest.test.ts`. I test chiudono i server temporanei nel blocco di pulizia.

## World Painting

La sezione **Painting** del World Maker configura l’aspetto della mappa selezionata, con anteprima dettagliata da 12 pixel per cella. A zoom più lontani resta la vista semplificata. L’anteprima si può disattivare; colori, regolazioni e annullamento sono salvati nella bozza, nell’esportazione e tramite **Applica al gioco**. Gli interni possono avere una propria configurazione.

**Livelli grafici** permette di attivare separatamente Mare e Maschere. Mare OFF usa acqua piatta; Maschere OFF usa celle quadrate. Le impostazioni dettagliate sono conservate per la riattivazione. Queste scelte cambiano soltanto il disegno, senza modificare generazione e collisioni.

Il menu **Bordi** confronta il rendering precedente con le nuove maschere. Ogni quadrato grafico collega i centri di quattro celle: i quattro angoli producono 16 combinazioni con punti di incontro condivisi sui lati. **Curvatura** passa da tagli diagonali a raccordi curvi. Le diagonali e gli incontri di tre o più materiali usano una priorità deterministica: acqua, erba, fango, ghiaccio, strada, neve, pietra. Il mare è una base continua coperta dalla terra; acqua e collisioni rimangono celle della simulazione.

Ogni materiale ha colore base, intensità e grandezza delle macchie. L’erba e le strade conservano le variazioni climatiche relative al colore scelto. Rocce e cespugli procedurali conservano forme e ombreggiature; gli asset importati mantengono la propria immagine. Il reset ripristina soltanto la pittura della mappa selezionata.

Le maschere geometriche vengono riutilizzate e le macchie sono raggruppate per materiale. Tutto confluisce nella stessa cache raster scorrevole del gioco: non si aggiungono passaggi al frame quando la cache è valida, né canvas grandi quanto il mondo. I test browser confrontano tempi di ricostruzione con la modalità precedente, riutilizzo della cache, scorrimento, tutti i 16 casi e salvataggio completo delle impostazioni.

**Modifica le singole maschere…**, oppure un clic su una miniatura, apre l’editor del contorno. Si possono trascinare, aggiungere e rimuovere fino a otto punti per contorno, scegliere raccordi morbidi o spezzati e partire dal preset Onda. Le diagonali hanno due contorni modificabili separatamente. Gli estremi sui lati sono fissi; 0 e 15 restano rispettivamente vuota e piena. **Applica maschera** salva la forma nella bozza; **Ripristina questa maschera** rimuove solo quella personalizzazione. Le forme sono comuni alle coppie di terreni e supportano annullamento, esportazione e riapertura. La curvatura generale continua a controllare le maschere non personalizzate.

Sfondo, forme e ritagli condividono la stessa griglia di pixel, evitando righe di colore residuo alle giunzioni con zoom frazionari. Le forme personalizzate sono compilate nelle 16 geometrie in cache; agli incontri tra più terreni viene rispettata la priorità anche se i contorni disegnati si sovrappongono.

Il selettore **Regola dei passaggi** distingue **Generale**, **Materiale** e **Coppia di materiali**. Una personalizzazione dell’acqua viene usata nei suoi passaggi verso tutti gli altri terreni. Una coppia specifica, come acqua–erba, prevale sulle regole dei materiali; altrimenti vince il materiale personalizzato con priorità maggiore. Le maschere non personalizzate ereditano quelle del livello precedente. La priorità iniziale è acqua 70, pietra 60, neve 50, strada 40, ghiaccio 30, fango 20, erba 10; si può cambiare, e a parità la scelta è stabilizzata per chiave alfabetica. **Rimuovi eccezione · eredita** elimina solo la regola selezionata.

Il colore pieno dell’anteprima indica il terreno che definisce la maschera; l’altro terreno usa il contorno complementare, senza disegnare un bordo indipendente. Nelle coppie il terreno guida è selezionabile. Agli incontri di tre o quattro materiali prevale una regola per quadrato: prima la specificità, poi la priorità, poi la chiave. I contorni restano raccordati sui lati. Questa scelta evita soluzioni geometriche incompatibili nello stesso punto.

La risoluzione delle precedenze avviene quando si ricostruisce il terreno. Le combinazioni condividono al massimo 29 regole compilate (generale, sette materiali, 21 coppie); le regole non aggiungono canvas. Il gioco può usare una seconda bitmap per preparare il terreno prima che la camera lo raggiunga. Problema, soluzione, misure sul telefono e limiti sono descritti in [Prestazioni del client](performance.md).

## Punti sonori

Lo strumento **♫ Punto sonoro** posiziona una sorgente musicale sulla mappa, separata dalle zone. Dopo averla piazzata, scegli o importa una traccia MP3, OGG o WAV (massimo 20 MB), imposta il volume massimo e premi **Aggiorna**. Il raggio interno mantiene il volume pieno; tra questo e il raggio di ascolto il volume diminuisce gradualmente. Oltre il cerchio esterno la traccia è ferma. I raggi sono in celle: quello esterno deve superare quello interno (massimo 1024 celle).

Il marker ♫ indica il centro della cella; selezionandolo compaiono i due cerchi. Puoi trascinarlo, cambiarne le coordinate, rimuoverlo e usare annulla/ripeti. I punti sono elencati in **Esplora oggetti → Punti sonori** e in **Progetto e verifica → Zone e punti sonori**. Ogni mappa, compresi gli interni, conserva i propri punti.

Nel gioco le tracce vanno in loop, seguono distanza e direzione stereo e si sovrappongono alla musica della zona. Usano il controllo **Musica** e il mute generale. Si attivano soltanto nel raggio di ascolto e si fermano all'uscita, al cambio mappa o all'uscita dal gioco. Per contenere il numero di stream vengono riprodotti al massimo i quattro punti più udibili. Rientrando nel raggio la traccia riprende dal punto raggiunto; l'opzione **Ricomincia la canzone a ogni ingresso** permette invece di ripartire dall'inizio. I punti e i file musicali vengono inclusi nell'esportazione del progetto e ripristinati con l'importazione.
