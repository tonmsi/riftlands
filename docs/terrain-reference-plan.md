# Pareti, scale, ponti e composizione: studio delle reference e piano

13 ottobre 2026. Questo documento completa `docs/stairs-and-heights-study.md` con i sei nuovi allegati, le loro animazioni e il confronto con il progetto effettivamente presente nel workspace.

**Risultato:** la base fisica e la direzione illustrata di Riftlands sono riutilizzabili. L'effetto delle reference dipende dalla coerenza fra sagoma del terreno, raccordi, percorso dei piedi, elementi del ponte e oggetti appoggiati alla superficie corretta. Il lavoro riguarda sia la costruzione grafica sia la geometria dei passaggi. Le estensioni descritte sono ora implementate nel runtime, negli editor e in una scena completa separata.

## Stato dell’implementazione

La scena **Terrazze, scale e ponte**, apribile da `/surface-lab.html?scene=reference` e copiabile dal catalogo del Dungeon Maker, rende verificabili le sei fasi del piano. La geometria della mappa installata è conservata; tre asset dimostrativi sono stati aggiunti al catalogo senza generazione automatica.

- Scale corte e multicella con identificativo, larghezza, pianerottoli e profilo condiviso da grafica, piedi, camera e collisioni. Restano compatibili gli accessi adiacenti precedenti.
- Quote fisiche intere, supporti intermedi distinti dal terreno inferiore, percorso NPC e persistenza nei formati World/Dungeon e nella ricollocazione.
- Aperture del kit roccioso in tutte le direzioni, gradoni senza piccole terrazze intermedie e fianchi più leggibili.
- Ponte con spessore, parapetti anteriori/posteriori, aperture, sostegni e ombra, calcolati dall’unione delle celle. Costruttore largo 1–3 corsie con svolta e prolungamento per creare rami.
- World Maker e Dungeon Maker con posa/anteprima dell’intero ingombro, selezione del supporto, cancellazione della struttura e undo unico.
- Composizione giocabile con sei scale, terrazze annidate, ponte a L/T, percorso inferiore, rive, alberi e casa appoggiati alla quota corretta.

Le prove automatiche coprono salita/discesa nelle quattro direzioni, corridoio e raggio dell’attore, profilo continuo, passaggio NPC, serializzazione, ricollocazione, separazione sopra/sotto e rimozione dei supporti con il loro contenuto. Le prove browser verificano transito reale, aperture, ordine dei parapetti, trasparenza locale per gli attori inferiori, esportazione e copia nel Dungeon Maker. Gli screenshot sono in `artifacts/terrain-reference-overview.png`, `terrain-reference-under.png` e `terrain-reference-bridge-close.png`. Le istruzioni d’uso aggiornate sono in `docs/terrain-surfaces.md`.

Verifica finale del 13 ottobre 2026: `npm test` **464/464**; `npm run build` riuscito (TypeScript e produzione Vite). Le tre prove browser `terrain-reference-browser` e `bridge-art-browser` passano; passano anche le prove del kit roccioso, del laboratorio precedente e del movimento sulle scale.

Il piano sotto conserva l’analisi e i criteri usati per l’implementazione. La composizione della mappa di gioco rimane un lavoro editoriale successivo, da svolgere con i nuovi strumenti.

## 1. Materiale esaminato

I tre allegati inizialmente non caricati sono stati ritrovati nella cartella `C:/Users/tomma/Desktop/tile lab`.

| Originale | Dati verificati | Utilità |
|---|---|---|
| `tile lab/Cmm6Jjn.png` | RGBA, 256×41504 px; sei tavole diagnostiche coprono tutta l'altezza | Inventario completo e costruzione modulare di terreno, scogliere, scale, edifici, ponti e oggetti |
| `tile lab/JN3xqlg.gif` | 240×160 px, 309 frame, ciclo 10,30 s | Attraversamento di un altopiano da entrambe le scale laterali |
| `tile lab/Jr75OdM.gif` | 240×160 px, 225 frame, ciclo 11,30 s | Salita/discesa, cambio di direzione, velocità diverse e NPC vicini |
| `tile lab/dejgwnd-d2899b1a-dc78-4a40-8d59-7895170f9ae9.png` | 64×64 px, diagramma LARGE/SMALL | Confronto di ingombri di pezzi laterali; non prova due quote diverse |
| `images.jpg` | RGB, 480×360 px | Scala frontale e scala laterale inserite nella stessa terrazza |
| `0ze5tbpuenah1.png` | RGBA, 1211×3209 px | Composizione estesa di montagne, rive, accessi e ponte con svolte e piazzole |

Le PNG e le GIF sono state lette dagli originali. Le immagini diagnostiche sono in `artifacts/terrain-reference-study`. Gli asset originali, il codice e la mappa installata non sono stati modificati durante questo studio.

### Risoluzione e suddivisione dei tile

L'intero `Cmm6Jjn.png` è un ingrandimento esatto 2×: ogni blocco 2×2 ripete lo stesso pixel. Sono stati confrontati tutti i pixel, con zero differenze su 5.312.512 confronti per asse. La risoluzione artistica effettiva è quindi 128×20752 px.

I moduli ricorrenti da 32 px nel file corrispondono a 16 px artistici; le suddivisioni da 16 px corrispondono a 8 px artistici. L'identificazione con la griglia Pokémon da 16 px è un'inferenza molto solida, non un metadato di collisione presente nell'immagine.

Questo conferma l'utilità di costruire un tile con parti più piccole: mezzo bordo, quarto di angolo, terminale e porzioni di gradino. **La suddivisione grafica non assegna automaticamente quote indipendenti a due metà della cella fisica.** Per Riftlands si conserva la cella da 48 px; raccordi e geometrie interne possono usare dimensioni più fini.

L'atlante ha alpha reale, comprese ombre semitrasparenti. Il fondo a scacchi delle tavole diagnostiche è stato aggiunto solo per l'ispezione. Alcune varianti degli alberi hanno invece fondi dipinti propri: non vanno confuse con elementi completamente trasparenti. Il credito visibile nell'atlante è UltimoSpriter.

## 2. Inventario dell'intero atlante

Le coordinate sono Y nel file originale da 41504 px, prima di qualsiasi ridimensionamento. Alcuni gruppi si sovrappongono o sfumano nel successivo.

| Fascia Y | Famiglie riconosciute | Regola di costruzione utile |
|---|---|---|
| 0–832 | Erbe alte/basse, fiori, cespugli, vegetazione e varianti cromatiche | Piccoli dettagli distribuiti sopra un fondo continuo; evitare che ogni oggetto introduca una toppa di terreno |
| 832–1984 | Acqua, rive, sabbia, erba e angoli naturali | Centro, bordo, angolo convesso/concavo e raccordi parziali |
| 1984–2144 | Gradini chiari con barre verticali e orizzontali | Pedata e alzata separate visivamente; il rettangolo del pezzo non misura il dislivello |
| 2144–2976 | Terra, sabbia, neve e ghiaccio | Famiglie di materiali con raccordi compatibili |
| 2976–4512 circa | Pavimenti, lastre, piazze e vasca ornamentale | Ripetizione del centro, cornici e terminali |
| 4512–5488 circa | Binari/traverse, tronchi e bordi sottili | Elementi direzionali con estremità distinte |
| 5504–6240 | Scogliera erbosa principale | Sommità, corpo, piede, lati, angoli interni/esterni e tre altezze di faccia |
| 6240–9400 circa | Rocce nude, arancioni, innevate/azzurre, massi e grotte | Stessa grammatica adattata a materiali diversi; ingressi frontali e laterali specifici |
| 9472–15648 circa | Conifere, alberi tondeggianti/appuntiti, arbusti e gruppi | Base a terra distinta da chioma; diverse dimensioni e densità |
| 15648–35520 circa | Case, edifici pubblici, torri, magazzini e strutture industriali | Tetto, facciata, porta, piede, gradini d'ingresso e ombra |
| 35520–36128 | Ponte/passaggio chiaro modulare | Impalcato, bordi, parapetti, testate, elementi verticali e ombra |
| 36096–38912 | Recinzioni, cancelli, lampioni, cartelli, cassette, transenne, fontane/statue e aiuole | Base/collisione e parte alta hanno funzioni differenti |
| 38912–40128 | Panchine, siepi, ombrelloni, pergole e archi | Coperture separate dai sostegni; spazio libero sotto da definire fisicamente |
| 40064–41504 | Veicoli, caravan e barche speculari | Orientamenti e ancoraggi coerenti; non ogni sagoma è un tile singolo |

Nell'atlante non è stato identificato un foglio di animazioni degli attori. Le animazioni utili provengono dai due GIF.

Tavole complete: `atlas/contact-01.png` … `atlas/contact-06.png`. Dettagli principali: `atlas/rock-cliff-kit.png`, `atlas/cliff-source-grid.png`, `atlas/stairs-source-grid.png`, `atlas/bridge-decks.png` e `atlas/wooden-rail-kits.png`, tutti sotto `artifacts/terrain-reference-study`.

## 3. Dettagli delle pareti e delle terrazze

Nel kit principale si distinguono un bordo erboso, una stretta fascia di terra chiara, il corpo scuro e un piede irregolare. Gli angoli convessi sporgono, mentre le rientranze hanno raccordi propri. I fianchi sono diversi dalla faccia frontale: non sono semplicemente la stessa striscia ruotata.

La tavola sulla griglia mostra facce nominali da una, due e tre fasce di 32 px del file, cioè 16, 32 e 48 px artistici. Esempi: facce a Y5632–5664, Y5920–5984 e Y6112–6208. Aumenta il corpo verticale, mantenendo una costruzione coerente di sommità e piede. Non si ingrandisce uniformemente l'intera scogliera.

Le GIF e la mappa applicano questi pezzi al contorno del terreno: fronti lunghi, rientranze, spalle strette, massicci, isole e terrazze annidate. Le fasce scure separano i livelli senza richiedere un cambio di texture su ogni piano. Il piano superiore resta una superficie continua.

In Riftlands il fronte sud è già estruso dalle quote, mentre i lati est/ovest si leggono soprattutto tramite bordo e smusso. La prima correzione deve rendere più chiari quei fianchi con corpo, piede e ombra coerenti con la nostra camera. Importare una faccia isometrica laterale altererebbe la proiezione.

## 4. Scale: cosa mostrano immagini e animazioni

### Costruzione grafica

In `images.jpg`, la scala frontale e quella laterale attraversano la stessa fascia rocciosa. Le spalle sono le terminazioni della parete ai lati dell'apertura. Testa della scala e superficie alta combaciano; il piede raggiunge il terreno basso senza una roccia residua nel corridoio.

Le laterali misurate nelle GIF hanno un tratto diagonale centrale 1:1. Le barre dei gradini sono verticali nell'immagine, mentre il personaggio percorre la scala lateralmente. Le frontali usano fasce orizzontali. Una scala frontalmente leggibile non si ottiene ruotando un nastro con la stessa texture.

L'atlante contiene anche gruppi di gradini rettangolari a X128–192/Y1984–2080 e X0–96/Y2080–2144. Non mostrano la medesima diagonale delle scale nei GIF: non sono una prova che tutte le famiglie abbiano identica pendenza. I gradini delle porte sono un'altra famiglia, integrata nel piede della facciata.

Il diagramma LARGE/SMALL confronta ingombri visivi. Da solo non prova che il pezzo più grande raggiunga un piano più alto.

### Movimento verificato

La camera segue il protagonista: il personaggio resta vicino al centro dello schermo mentre lo scenario scorre. Per misurare la salita è stata registrata una texture fissa del terreno, anziché leggere soltanto la posizione del personaggio nello schermo.

- `JN3xqlg`, frame 23→29: l'ancora del terreno si sposta di −12 px in X e +12 px in Y. Il personaggio, rispetto allo scenario, avanza +12 px e sale −12 px. Prima e dopo la rampa il movimento torna orizzontale.
- `Jr75OdM`, frame 16→20: +12 px a destra e +12 px in basso nella discesa. La porzione completa frame 10→22 avanza 32 px, ma circa metà è avvicinamento sul piano: la rampa effettiva non è lunga 32 px.
- In `Jr75OdM` si osservano ritorni, cambi di direzione e velocità proiettata circa doppia in alcuni tratti. È compatibile con la corsa; non prova uno specifico flag del motore.

Non sono stati identificati bici, follower o ponti nei GIF. La scala frontale è visibile nel secondo filmato ma non chiaramente percorsa. Le animazioni provano la traiettoria disegnata, non variabili interne Z o tutti i vincoli di collisione.

**Conseguenza progettuale:** distinguere lunghezza inclinata, avvicinamento, pianerottoli, larghezza e rettangolo grafico. La quota visiva deve seguire l'intera struttura. Nel tratto centrale si preferisce una progressione regolare coerente con i gradini, con raccordi brevi agli estremi; non un nuovo smoothstep per ogni cella.

Misure e sequenze complete: `artifacts/terrain-reference-study/motion/analysis-it.md` e le tavole `JN3xqlg-transitions.png` / `Jr75OdM-transitions.png`.

## 5. Ponte e composizione della mappa

La mappa grande mostra un percorso elevato che attraversa acqua e terreno. Il ponte mantiene un impalcato continuo anche nelle svolte, nei restringimenti, nelle biforcazioni e nelle piazzole. I bordi seguono la sagoma complessiva; vengono interrotti presso gli accessi. Le testate raccordano la struttura al terreno.

I sostegni si ripetono lungo i fronti e chiariscono la distanza dal piano inferiore. Le fasce laterali hanno spessore e ombre: il ponte si legge come struttura, non soltanto come materiale del pavimento. La sua palette fredda e uniforme lo separa dalla roccia più calda e articolata.

L'immagine statica non dimostra la possibilità di camminare sotto. Il requisito sopra/sotto per Riftlands deriva dal suo sistema già presente e dalla prova del laboratorio.

I percorsi liberi hanno un contrasto più tranquillo di rocce e vegetazione. Gli alberi formano gruppi leggibili, mentre accessi, scale e testate conservano spazio. Edifici e oggetti hanno basi riconoscibili; chiome e tetti possono coprire zone vicine senza trasformare tutta la sagoma in ostacolo. Questa separazione deve restare coerente con selezione dell'editor e piano fisico.

## 6. Confronto con Riftlands attuale

Sono state osservate le versioni effettive del workspace, comprese le modifiche non committate, e sono state eseguite le prove del laboratorio nel browser.

| Area | Da riutilizzare | Intervento necessario |
|---|---|---|
| Quote | Tile 48 px; quota 16 px; superfici distinte; client/server e persistenza | Un contratto coerente fra quota, proiezione e ancoraggi; nessun cambio globale delle unità |
| Terreno | Materiali illustrati, contorni naturali, rive e dettagli stabili | Raccordi più chiari fra bordi, pareti, accessi e decorazioni |
| Roccia | Kit `rock-cliffs-v1`, sommità/corpo/piede, anelli e terrazze | Fianchi leggibili, giunti fra altezze e maschere condivise degli accessi |
| Scale | Gradini nei quattro orientamenti; transito fra celle; camera e piedi interpolati | Corsa, corridoio, larghezza e pianerottoli espliciti; percorso continuo su più celle |
| Ponti | Superficie indipendente, terreno sottostante conservato, accessi, NPC e fade | Impalcato, parapetti, sostegni, sagoma composta e strumenti per larghezze/svolte |
| Oggetti | Catalogo, ancoraggi, superfici, occultamento e selezione | Verifica delle proporzioni e della base; decorazioni escluse dai corridoi |
| Editor | Anteprime, undo, scelta del piano visibile e vista sotto ponte | Posa di strutture complete, validazione della sagoma e clipping coerente col gioco |

### Limiti da risolvere, non soltanto ridisegnare

1. Ogni scala attuale è un link fra due celle adiacenti. La corsa è sempre 48 px, anche per dislivelli grandi.
2. Gradini larghi 30 px, apertura frontale 34 px e passaggio logico sul bordo da 48 px non coincidono. Con raggio attore 15 px, un corridoio largo esattamente 30 px avrebbe zero margine.
3. La salita verso sud può ripiegarsi nella proiezione attuale; con tre quote gli estremi coincidono. Validare il profilo effettivo, compresi gli offset dei pianerottoli, è più corretto di imporre una lunghezza fissa per tutte le direzioni.
4. L'apertura è disponibile soltanto sul fronte roccioso sud; il labbro superiore e altri materiali non condividono ancora una sagoma completa dell'accesso.
5. Lo strumento ponte crea un segmento rettilineo largo una cella. Il runtime gestisce già deck più larghi: la demo ne usa uno largo tre celle.
6. Il ponte viene disegnato come pavimento con bordi sottili e ombre per cella. Mancano componenti strutturali che rendano leggibile l'altezza.
7. Una ringhiera anteriore deve poter coprire i piedi di chi cammina sopra: il passaggio di disegno delle superfici, che precede gli attori, non basta per tutta la ringhiera.
8. Se si smussa o restringe la sagoma del ponte, il clipping rettangolare per cella del World Maker deve essere aggiornato alla stessa impronta.

La prova visiva attuale è conservata in `artifacts/rock-cliff-kit-review.png`, `artifacts/rock-stairs-playtest.png`, `artifacts/surface-lab-above.png` e `artifacts/surface-lab-under.png`.

## 7. Piano di lavoro

### Fase 1 — Scena di confronto e contratto geometrico

Usare `/surface-lab.html` per una piccola scena completa: terrazza, rientranza, parete a doppia fascia, scale frontali/laterali, ponte sopra acqua e percorso, un albero e un edificio. Includere dislivelli di 1, 3 e 6 quote, scale strette/larghe, salita e discesa. Acquisire la vista attuale a zoom normale.

Definire una sola trasformazione da coordinate del mondo a posizione disegnata. Documentare ingresso, uscita, base dell'attore, larghezza utile, lunghezza inclinata e pianerottoli. La dimensione grafica dei pezzi può essere inferiore a un tile senza suddividere tutta la griglia fisica.

**Completata quando:** la scena è riproducibile, scaricabile e indipendente dalla mappa installata; ogni misura è espressa nelle unità di Riftlands.

### Fase 2 — Scala corta integrata nella parete

Ricavare da una geometria condivisa gradini, spalle, pianerottoli, apertura della faccia e interruzione del labbro. Dare al corridoio una larghezza utile compatibile con l'attore; la prima corsia fisica deve offrire margine rispetto al diametro di 30 px. Disegno, piedi, camera e collisioni devono usare lo stesso percorso.

Per le quattro direzioni verificare che i gradini restino leggibili e il profilo non si ripieghi. Le combinazioni troppo corte richiedono estensione della corsa o segnalazione nell'anteprima. Distinguere la pendenza dell'asset dalla lunghezza centro-centro degli estremi.

Le restrizioni delle nuove anteprime non devono rendere invalide scale corte già salvate. Conservare il transito dei collegamenti legacy; le costruzioni che richiedono più spazio devono avere una conversione controllata, con verifica dell'ingombro e gestione dei conflitti. La compatibilità del parser da sola non garantisce la compatibilità del movimento.

**Completata quando:** salita, discesa, arresto, inversione e movimento rapido funzionano; non si passa dentro le spalle; la parete non resta nel corridoio e i piedi non galleggiano.

### Fase 3 — Scale su più celle

Aggiungere un'identità di struttura con estremi, percorso rettilineo iniziale, larghezza, quote, pianerottoli e profilo. Conservare i collegamenti adiacenti: derivarli dalle celle della struttura per riutilizzare collisioni e A*. La sola ammissione di un link fra estremi lontani violerebbe assunzioni del runtime.

Mantenere le quote fisiche intere. Specificare il supporto nelle celle intermedie e la presentazione continua sull'intera rampa; evitare che il disegno ordinario delle celle intermedie introduca piccole terrazze nel corridoio. La politica di interazioni/combattimento durante il transito continua a usare il supporto fisico e va testata.

Aggiornare schema opzionale e compatibile con mappe vecchie, validazione, copia/esportazione/ricollocazione e selezione della struttura. Negli editor, scegliere estremi, larghezza e profilo con anteprima dell'intero ingombro; posa e rimozione sono transazioni con undo unico.

**Completata quando:** scale di una o più celle attraversate condividono un profilo coerente, vengono percorse dagli NPC e sopravvivono a salvataggio, caricamento e ricollocazione.

### Fase 4 — Pareti e raccordi modulari

Rifinire il kit roccioso esistente prima di generare nuovi asset. Migliorare sommità, piede, fianchi, concavità e passaggi fra quote diverse. Aumentare il corpo verticale mantenendo dimensione delle pietre e spessore del bordo. Gli accessi della Fase 2/3 devono tagliare la stessa geometria usata dalla parete.

Applicare la regola a fronte lungo, L/T, anello, pilastro, rientranza e terrazze. L'illustrazione di Riftlands resta il riferimento di palette e luce; dai tileset si trasferiscono modularità e proporzioni.

**Completata quando:** le altezze si leggono anche lateralmente, i giunti non mostrano fessure e le pareti più alte non hanno pietre o bordi dilatati.

### Fase 5 — Ponte con struttura leggibile

Prima completare il ponte già presente con impalcato, fascia laterale, parapetti, testate, sostegni e ombra. Classificare il contorno dell'unione delle celle: bordi esterni, angoli interni/esterni e accessi. Separare gli elementi dietro agli attori da quelli davanti; riutilizzare il sistema di quote e occultamento esistente.

Poi ampliare il costruttore con percorso a segmenti, larghezza, svolte a 90°, T e piazzole. Le aperture delle ringhiere seguono gli accessi fisici. I sostegni iniziali hanno funzione grafica; qualunque base realmente bloccante deve essere definita sul piano inferiore e verificata rispetto ai passaggi, anziché introdurre collisioni implicite.

Conservare terreno/acqua sottostanti e identità dei supporti. Sagoma, collisioni del bordo, selezione e clipping degli editor derivano dalla medesima impronta. La trasparenza resta uno strumento di leggibilità degli attori coperti; impalcato, attori sotto e parapetti devono essere verificati anche quando il giocatore è sopra.

**Completata quando:** il ponte si legge a zoom normale, gli accessi sono aperti, le curve non hanno ringhiere interne spurie e due personaggi sopra/sotto restano separati fisicamente e leggibili.

### Fase 6 — Composizione e applicazione negli editor

Completare la scena con acqua, rive, sentieri, alberi, rocce, edificio e piccoli oggetti già disponibili. Uniformare scala visiva, illuminazione e peso dei dettagli. Chiome e tetti si ordinano dalla base; i corridoi e i pianerottoli conservano spazio. Gli asset vengono appoggiati al supporto corretto.

Portare tutte le costruzioni nel World Maker e nel Dungeon Maker con anteprime fedeli al gioco, selezione della struttura intera, vista inferiore e undo coerenti. Verificare una mappa più estesa e le cache solo dopo aver ottenuto una scena piccola convincente.

**Completata quando:** editor e gioco rappresentano gli stessi accessi e piani; la scena completa è navigabile da giocatori e NPC ed è leggibile senza aprire un overlay tecnico.

## 8. Aree di codice coinvolte

| Area | File principali |
|---|---|
| Dati e supporti | `shared/world-surfaces.ts`, `shared/world-schema.ts`, `shared/world.ts`, `shared/physics.ts` |
| Profilo e movimento | `shared/surface-presentation.ts`, `shared/surface-navigation.ts`, `client/core/motion.ts`, `client/core/prediction.ts` |
| Contorni e pareti | `client/render/surface-contours.ts`, `client/render/surface-terrain.ts`, `client/render/rock-cliff-art.ts` |
| Gradini | `client/render/rock-cliff-geometry.ts`, manifest e kit `rock-cliffs-v1` |
| Ordine del disegno | `client/render/render.ts`, occultamento asset e attori |
| Posa e anteprima | `client/editors/surface-authoring.ts`, `client/editors/world/elevation-editor.ts`, `client/editors/dungeon/dungeon-surfaces-editor.ts`, `client/editors/world/world-editor-canvas.ts` |
| Scena di prova | `client/surface-lab.ts`, `shared/rock-cliff-demo.ts`, `shared/surface-demo.ts`, `shared/dungeon-surface-demo.ts` |

Le righe citate nello studio precedente fotografavano il codice di quel momento; i file sono stati riletti per questo piano e alcune funzioni si sono spostate. In particolare la sequenza dei piani è attualmente in `client/render/render.ts:415`, mentre il disegno generico dei collegamenti è in `client/render/surface-terrain.ts:444`.

## 9. Verifica della base e criteri di accettazione

Verifiche svolte durante lo studio:

- TypeScript: `tsc --noEmit`, passa.
- 44 test mirati: geometria dei gradini, presentazione, authoring, contorni, superfici e demo rocciosa, passano.
- Due prove browser: `rock-cliff-browser` e `surface-lab-browser`, passano; includono caricamento asset, apertura frontale, transito e supporti sopra/sotto. Verificano anche che la mappa installata resti invariata.

Questi risultati documentano il punto di partenza prima dell’implementazione. Le verifiche delle estensioni sono riassunte nello stato dell’implementazione all’inizio del documento; comprendono corridoio e raggio dell’attore, monotonia del profilo, transito multicella, NPC, serializzazione, ringhiere davanti agli attori e clipping dei ponti.

Il primo risultato da valutare è **una scena completa con terrazza, scala laterale e frontale, ponte e percorso inferiore**, usando i nostri materiali e personaggi. Rende concretamente confrontabile l'effetto prima di applicare le regole all'intero mondo.
