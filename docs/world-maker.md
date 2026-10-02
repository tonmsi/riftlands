# World Maker locale

Avvia `npm run world:studio` e apri `http://127.0.0.1:3002/world-maker.html`. `WORLD_STUDIO_PORT` cambia la porta. L’editor è un processo locale separato dal server del gioco: non aggiunge API di amministrazione al gioco e non apre il server multiplayer.

Per applicare il progetto, ferma il server del gioco. La stessa esclusione usata dal Dungeon Studio impedisce modifiche mentre il salvataggio è in uso. Dopo **Applica al gioco**, esegui `npm run build` e riavvia il gioco. Se il gioco usa `DATA_FILE`, avvia lo Studio con lo stesso `DATA_FILE`. `Ctrl+C` chiude lo Studio, compresi i suoi socket.

## Asset e griglia

Importa uno o più PNG/SVG. Le immagini vengono conservate in `public/world-assets` con un nome derivato dal contenuto: importare la stessa immagine non crea una seconda copia. Il catalogo può contenere più definizioni della stessa immagine, con scale e comportamenti diversi.

Le dimensioni sono in quadratini, anche frazionarie, da 0,25 a 32 per asse. **Mantieni proporzioni** collega larghezza e altezza; disattivalo per dimensionarle separatamente. Le celle occupate sono arrotondate per eccesso. Nell’anteprima ogni cella ha proprietà indipendenti:

- Movimento: calpestabile oppure bloccante. Il terreno sottostante mantiene le sue collisioni: per un ponte sopra acqua va definito anche il percorso calpestabile.
- Visibilità: normale, nascondiglio oppure trasparente al passaggio. Il nascondiglio usa la stessa logica autorevole dei cespugli; la trasparenza non imposta il player come nascosto.

Scegli le due proprietà e dipingi sulle celle, oppure applicale a tutto l’asset. Ridimensionare conserva le annotazioni delle celle ancora presenti; quelle aggiunte sono calpestabili e normali. **Sfondo** disegna prima degli attori. **Oggetto** si ordina rispetto agli attori tramite la base verticale, da 0 (alto) a 1 (basso). L’immagine e la maschera condividono l’origine in alto a sinistra.

Aggiornare un asset aggiorna tutte le sue istanze. **Verifica ingombri e riferimenti** segnala, tra l’altro, spawn bloccati e asset dentro dungeon. La validazione è ripetuta sul server locale prima dell’applicazione.

**Aspetto** sceglie l’immagine importata oppure il disegno animato di un braciere/fuoco da campo. Questi due disegni conservano fiamme, bagliore e scintille originali, scalano con l’asset e funzionano sia nel gioco sia nell’editor. La scelta è salvata nei dati dell’asset e non dipende dal suo nome o dalla posizione. Le vecchie bozze che referenziano le immagini iniziali di fuoco e braciere ricevono lo stesso disegno animato; scegli esplicitamente **Immagine importata** per mantenerle statiche.

PNG: massimo 5 MB, 8192 pixel per asse e 32 milioni di pixel totali. SVG: massimo 5 MB, forme e riferimenti interni; script, animazioni SVG, oggetti HTML e risorse esterne sono esclusi. Il gioco decodifica le immagini fuori dal ciclo di rendering, rasterizza gli SVG e limita la cache a 256 bitmap / 16 milioni di pixel, con al massimo otto caricamenti contemporanei.

## Disegnare il mondo

Il mondo non ha larghezza o altezza iniziali. La vista esplora coordinate positive e negative; **Vai a…** raggiunge una posizione in quadratini. La rotella ingrandisce attorno al cursore. Spazio + trascina, tasto centrale o tasto destro spostano la vista. A zoom lontano la vista usa campionamento del terreno per contenere il lavoro per fotogramma.

- **Terreno**: pennello continuo con raggio. Le celle dipinte restano manuali e disabilitano gli asset procedurali su quelle celle.
- **Asset**: piazzamento singolo. Ctrl + trascina, oppure **Asset con pennello continuo**, usa raggio e densità del pennello. La distanza minima evita accumuli; i passaggi veloci interpolano le celle attraversate.
- **Cancella**: rimuove asset manuali e NPC nell’area e impedisce che gli asset generati ricompaiano. Conserva il terreno dipinto.
- **Procedurale**: elimina l’intervento sul terreno e il blocco alla rigenerazione, lasciando nuovamente lavorare il generatore. Non rimuove le istanze manuali.
- **Seleziona**: modifica coordinate di asset, NPC o dungeon. Le zone possono essere selezionate anche dal loro elenco.
- **Spawn player**: imposta il centro dello spawn globale. Chi rientra con una posizione salvata diventata bloccata viene riportato a uno spawn libero, conservando progressi e salute.

Una pennellata è una singola operazione annullabile. Ctrl+Z annulla; Ctrl+Shift+Z ripete. La cronologia è limitata sia nel numero di transazioni sia nella memoria. Le proprietà di collisione e visibilità possono essere mostrate sopra la mappa.

## Generazione e clima

Un asset può essere solo manuale oppure disponibile anche al generatore. Definisci categoria, terreni ammessi, temperatura, umidità, frequenza e distanza minima. Le categorie sono identificatori estensibili, ad esempio `vegetation`, `water` o `decoration`; l’idoneità concreta deriva dai terreni e dagli intervalli climatici scelti.

Temperatura e umidità sono normalizzate tra 0 e 1. Le regole vengono controllate su **ogni cella dell’ingombro**, non solo sull’origine. I piazzamenti manuali, le celle escluse, gli interni dei dungeon, i loro accessi e gli ingressi arena riservano lo spazio.

La frequenza è la probabilità/peso di proposta negli slot della propria fascia di dimensioni. Dimensioni e distanza determinano fasce da 1 a 64 celle; introdurre un asset grande non cambia la griglia di tutta la vegetazione piccola. Le proposte tra fasce risolvono sovrapposizioni e distanze tramite priorità determinate da coordinate e seed. Nessuna decisione dipende dall’ordine di esplorazione o dai chunk presenti in cache.

Le celle lasciate senza interventi restano procedurali. Le zone possono modificare solo temperatura e/o umidità: la temperatura controlla neve e ghiaccio, mentre l’umidità controlla bioma e fango. Strade manuali e interni dei dungeon mantengono il proprio terreno. Il cespuglio iniziale è ora una definizione del catalogo usata dal generatore; la vecchia tile `bush` resta compatibile con i dungeon e i terreni dipinti.

## Zone, NPC e arene

**Zona** crea un rettangolo trascinando sulla mappa; l’ispettore permette anche cerchi. Le proprietà non impostate sono ereditate. Per ogni proprietà prevale la priorità numerica più alta; a parità prevale l’ID in ordine alfabetico. Una zona climatica non cancella implicitamente la regola PvP di una zona sottostante.

Le zone gestiscono PvP, clima, generazione degli asset e NPC. Il comportamento delle zone senza PvP conserva il tempo di combattimento già previsto dal gioco: chi rientra mentre è ancora marcato in combattimento diventa protetto alla scadenza del tag.

Per gli NPC delegati, separa probabilità di spawn, limite per chunk e percentuali dei tipi. Le percentuali sommano a 100 oppure sono tutte a zero. Densità zero, limite zero o tutti i pesi zero escludono gli NPC delegati; quelli manuali rimangono. Le posizioni dei dungeon sono escluse dalla popolazione procedurale; i loro NPC rimangono definiti nel Dungeon Maker.

Gli ingressi arena indicano il profilo `arena-1`, quello attualmente implementato. Puoi creare più ingressi; ciascuna zona ha una coda separata, anche quando porta allo stesso profilo. Nuovi profili richiederanno la relativa implementazione nel sistema delle arene: il formato della zona è già predisposto.

## Dungeon e crocevia

Il catalogo installato è letto dal Dungeon Maker. Il World Maker colloca una sola istanza per dungeon installato, mantenendo gli ID di boss e incontri. Spostare trasla insieme terreno, ingressi, fiamme, regioni, punti di attivazione, NPC, pickup e spawn. Rimuovere dalla mappa disabilita l’istanza e conserva il dungeon nel catalogo; riposizionarlo lo riabilita.

Spostare o disabilitare un dungeon ripulisce **soltanto gli stati dei suoi boss**: cooldown di respawn e loot non raccolto di quel dungeon vengono azzerati. Gli altri dungeon e gli account restano conservati. La pulizia viene salvata prima del nuovo mondo, con backup: un’interruzione può lasciare i boss interessati azzerati nel vecchio mondo, che resta caricabile. Per ripristinare stato e posizione insieme, ripristina entrambi i backup a server fermo.

L’aggiornamento di un dungeon dal suo Studio usa la posizione scelta nel mondo e verifica la compatibilità con gli interventi manuali. Rimuovere definitivamente un dungeon dal catalogo ripulisce anche il suo riferimento nel documento del mondo.

Il crocevia iniziale è migrato nel documento: terreno, zona sicura, esclusione NPC, ingresso arena, pietre, bracieri e fuoco sono modificabili. Fuoco e bracieri mantengono il disegno animato originale come aspetto selezionabile del catalogo. Le immagini importate rimangono statiche; il loro formato di animazione generale è distinto dagli aspetti animati già integrati.

## Salvataggi e formato

La bozza usa IndexedDB, separata dal progetto applicato. Ogni applicazione usa una revisione del file per impedire che una finestra sovrascriva gli aggiornamenti di un’altra. **Ricarica progetto** sostituisce la bozza con il progetto sul disco; esporta prima se vuoi conservare entrambe le versioni. Una bozza recuperata da una revisione superata deve essere esportata e riconciliata prima di applicarla.

**Esporta** crea un JSON portabile con documento e immagini. I dungeon sono riferimenti al catalogo installato, che va trasferito insieme quando si usa un altro progetto. **Importa** ripristina le immagini nel deposito locale e carica il documento come bozza; non modifica il progetto fino all’applicazione.

Il documento versionato è `shared/custom-world.json`; immagini e catalogo sono distribuiti insieme al client. `shared/world-schema.ts` valida i dati; `shared/world-authoring.ts` gestisce indici e proposte; `shared/world.ts` applica le regole al generatore condiviso. Client, collisioni, proiettili e server autorevole usano le stesse definizioni. L’editor separa presentazione, rendering Canvas, cronologia e storage.

Le modifiche sono sparse e indirizzate per coordinate. I limiti correnti sono budget di importazione/editor, non dimensioni del mondo: 4096 asset, 100.000 istanze manuali, 500.000 celle modificate, 10.000 zone, 100.000 NPC manuali, coordinate entro ±10 milioni di celle e richieste di applicazione entro 40 MB. Chunk, proposte procedurali, zone consultate e bitmap hanno cache limitate.

Verifiche: `npm test`, `npm run build`, `npm run test:world-studio`. Per le verifiche complete nel browser, esegui `node --import tsx --test --test-concurrency=1 tests/integration/world-studio.test.ts tests/integration/world-render.test.ts tests/integration/terrain-browser.test.ts tests/integration/dungeon-studio.test.ts tests/integration/dungeon-playtest.test.ts`. I test chiudono i server temporanei nel blocco di pulizia.
