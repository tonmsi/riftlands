# Scale, pareti e quote: studio per Riftlands

Ricerca del 13 ottobre 2026. Analisi delle tre fonti indicate, della tavola di Adalkroofs allegata e del codice presente nel workspace. Le indicazioni di integrazione sono proposte: questo studio non modifica il motore, gli editor o le mappe.

## Risposta alle due ipotesi

**Un dislivello non occupa necessariamente un tile.** Occorre distinguere l'altezza della parete sullo schermo, le celle occupate nella mappa e la differenza di quota fisica. Un tileset può dedicare una riga di celle bloccanti alla faccia rocciosa; un motore con quote può invece estrudere il bordo di una superficie senza creare una cella parete separata. Riftlands usa il secondo modello.

**Le scale possono essere lunghe uno o più tile**, ma la lunghezza dipende da dislivello, inclinazione dell'asset, orientamento e raccordi. Non si ricava soltanto dal numero del piano raggiunto: una scala fra quota 9 e quota 12 ha lo stesso dislivello di una fra quota 0 e quota 3. La larghezza è un'altra dimensione indipendente.

In Riftlands, un tile misura 48 px e un incremento di quota produce 16 px di sollevamento grafico. Quindi una parete alta quanto un tile corrisponde a **tre incrementi di quota**, non a uno.

## Le grandezze da tenere separate

| Grandezza | Significato |
|---|---|
| Cella della mappa | Quadrato della griglia su cui si calcolano adiacenza e percorribilità. |
| Quota | Altezza del supporto fisico. Nel modello attuale è un intero fra 0 e 16. |
| Superficie | Supporto identificato da `surfaceId`; terreno e ponte possono occupare le stesse coordinate. |
| Dislivello | Differenza fra quota alta e quota bassa. |
| Corsa | Distanza percorsa in pianta fra ingresso e uscita; non comprende automaticamente i pianerottoli. |
| Ingombro della scala | Corridoio, celle attraversate, larghezza e raccordi che richiedono spazio. |
| Ingombro grafico | Rettangolo occupato da gradini, pareti, spalle, ombre e balaustre dopo la proiezione. |

Nei riferimenti GBA, «tile» può significare un elemento grafico 8×8, mentre il blocco di mappa è un metatile 16×16. Essentials usa celle 32×32. I valori in tile delle fonti vanno normalizzati prima di confrontarli con i 48 px di Riftlands. [Documentazione Porytiles](https://grunt-lucas.github.io/porytiles-user-docs/gba-decomp-tileset-system.html), [Game_Map di Essentials](https://github.com/Maruno17/pokemon-essentials/blob/master/Data/Scripts/004_Game%20classes/004_Game_Map.rb).

Anche l'`elevation` originale di Pokémon GBA non è una semplice altezza geometrica: alcuni valori hanno significati speciali per acqua, transizioni e ponti. Non si può importare quella numerazione come numero di piani del nostro mondo. [Documentazione del progetto pret](https://github.com/pret/pokeemerald/wiki/Random-Info,-Tips,-and-Tricks#elevation).

## Come è costruita la tavola allegata

Il JPG originale misura **256×10880 px**. Il file è una tavola grafica: non contiene metadati delle collisioni, degli autotile o delle quote. Il motivo a scacchi è incorporato nel JPEG; non è una trasparenza utilizzabile. La cadenza degli scacchi è compatibile con moduli da 32 px, ma non dimostra da sola la dimensione delle celle dell'eventuale gioco.

Gli ingrandimenti diagnostici sono in `artifacts/stairs-reference-cliff.png`, `artifacts/stairs-reference-bridge.png` e `artifacts/stairs-reference-front.png`. I provini con macrogriglia da 32 px sono `artifacts/cliff-analysis/reference-cliff-grid.png` e `artifacts/cliff-analysis/reference-side-stairs-grid.png`.

### Parete rocciosa

La parte alta della tavola mostra due composizioni arrotondate, una con sommità in terra e una con erba, oltre al fronte di una grotta e a rocce isolate. Si leggono componenti diversi:

1. **Sommità percorribile:** terra o erba viste dall'alto.
2. **Labbro del bordo:** fascia che raccorda la sommità alla faccia; nell'esempio erboso include ciuffi che scendono sulla roccia.
3. **Faccia rocciosa:** corpo scuro sotto il bordo, con solchi e volume verticale.
4. **Piede:** terminazione inferiore irregolare e ombra di contatto.
5. **Angoli e rientranze:** raccordi della sagoma, differenti da una semplice faccia rettangolare.

La faccia frontale si legge più profonda del bordo posteriore. Perciò un contorno intero non va trattato come una striscia di spessore uniforme. Le striature gialle sul piano marrone sono texture del terreno: non bastano a identificarlo come una scala.

Sul provino con griglia, il campione erboso comprende circa 5×5 moduli; la fascia frontale è contenuta approssimativamente in una riga da 32 px. Questa osservazione sostiene l'ipotesi di **una riga grafica per questo campione di parete**, senza dimostrare una regola per tutte le altezze o un ingombro fisico obbligatorio.

Per una parete più alta conviene mantenere sommità, piede e dimensione dei massi; si aggiungono moduli del corpo. Stirare l'intera composizione allargherebbe anche bordo, angoli e pietre. Per un sistema a quote, i moduli dovrebbero essere selezionati dalla differenza di altezza fra celle vicine e dalla forma del contorno.

### Scale

La tavola comprende elementi blu/grigi con due orientamenti laterali e un tratto frontale, oltre a una scala grigia davanti all'edificio verde nella parte bassa. Le strutture di legno vicine rappresentano pavimentazioni/passerelle: la ripetizione delle assi da sola non indica un dislivello.

Nelle scale laterali, i bordi di ingresso e uscita si trovano a diverse posizioni verticali; la successione dei gradini segue tale inclinazione. Le barre delle alzate restano verticali nell'immagine. Nelle frontali, le pedate sono fasce orizzontali alternate a linee scure delle alzate. Balaustre e spalle incorniciano la superficie percorribile, ma occupano spazio proprio.

Il dato utile per integrare queste forme è la corrispondenza fra **punto dei piedi all'ingresso, punto dei piedi all'uscita e faccia della parete attraversata**. Il bounding box completo dell'immagine, che comprende balaustre e ombre, non misura la corsa. Il JPG non consente di certificare quante celle siano bloccate né quanti piani raggiunga ciascun pezzo.

Misurando il tratto diagonale delle scale blu: circa **32 px di sviluppo orizzontale e 32 px di salita disegnata**, dunque rapporto circa **1:1**. Una rampa completa, comprese le spallette, ha un rettangolo di circa 54×124 px, vicino a 2×4 moduli; la distanza trasversale fra le balaustre è circa due moduli. Sono tre misure diverse: sviluppo della rampa, larghezza e bounding box. Questa reference non ha automaticamente la pendenza 1:2 dell'esempio Marin.

## Cosa insegnano le tre fonti

### FireRed: Sideways Stairs

La routine di Spherical Ice assegna sei comportamenti speciali alle tessere per ottenere movimento laterale con salita visibile. La disposizione delle collisioni segue la forma scalare: il fondo di ogni colonna viene bloccato e le altre tessere restano passabili. Il post contempla scale più estese e segnala che gli NPC richiedono un trattamento del movimento dedicato. La lezione applicabile è costruire insieme grafica, traiettoria e collisioni; dipingere soltanto una scala passabile non riproduce il movimento. Non è una specifica delle quote di Riftlands. [Post originale](https://www.pokecommunity.com/threads/fr-sideways-stairs.378934/).

### Essentials: Side stairs

La soluzione a eventi descrive scale profonde uno oppure due tile: entrambe correggono la posizione del giocatore di un tile verticale. La wiki confronta questa correzione con asset laterali che salgono circa mezzo tile per tile orizzontale e segnala limiti per rampe più lunghe. Il caso a due tile forza l'attraversamento completo. Il limite appartiene a quella tecnica; non vieta un modello continuo con lunghezze maggiori. [Documentazione](https://essentialsdocs.fandom.com/wiki/Side_stairs).

### Enhanced Staircases

Marin usa due eventi `Slope` sulle zone pianeggianti ai lati della scala. `Slope: AxB` specifica la distanza in tile, `Width` la corsia e la larghezza, `Offset` l'inizio della salita; il valore normale dell'offset è 16 px. Ingressi e uscite devono riallinearsi alla griglia. Per gli NPC il tutorial richiede `Through ON`: questa impostazione aggira collisioni e non è una soluzione da trasferire al nostro server. [Post originale](https://www.pokecommunity.com/threads/enhanced-staircases.437305/).

Nel codice del [port per Essentials 21.1](https://eeveeexpo.com/resources/1712/), lo spostamento grafico lungo la scala permette di derivare:

```text
tratto inclinato = |distanza X fra eventi| × dimensione tile − 2 × offset
salita grafica = |distanza Y fra eventi| × dimensione tile
```

L'esempio `3x-1`, con tile da 32 px e offset 16 px, ha un tratto inclinato di 64 px e una salita di 32 px. È dunque una rampa grafica lunga due tile, con estremi distanti tre: mezzo tile pianeggiante a ciascun lato. Questa è una derivazione dal codice, non una misura dell'immagine allegata. Il codice corregge coordinate e posizione disegnata; non introduce una quota fisica generale analoga alla nostra.

## Cosa fa oggi Riftlands

Le conclusioni seguenti sono verificate sul codice locale.

| Elemento | Comportamento attuale | Riferimento |
|---|---|---|
| Tile | 48 px | `shared/config.ts:7` |
| Unità di quota | 16 px | `shared/world-surfaces.ts:4` |
| Parete | Altezza grafica = 16 × differenza di quota; deriva dal bordo della superficie alta | `client/render/surface-terrain.ts:108` |
| Scala | Collegamento fra due celle cardinalmente adiacenti | `shared/world-surfaces.ts:50` |
| Corsa | 48 px da centro a centro, qualunque sia il dislivello | `client/render/rock-cliff-geometry.ts:12` |
| Gradini rocciosi | Larghezza grafica 30 px; numero adattato al dislivello | `client/render/rock-cliff-geometry.ts:17` |
| Apertura roccia | 34 px sul fronte sud, quando esiste il relativo collegamento | `client/render/rock-cliff-geometry.ts:45` |
| Movimento | Collegamento fra celle, senza controllo della larghezza del corridoio | `shared/world.ts:101` |
| Piedi/camera | Quota visiva interpolata fra gli estremi | `shared/surface-presentation.ts:32` |

La parete non occupa una cella propria. Anche la scala non ha una cella dedicata: la corsa attraversa metà della cella bassa e metà di quella alta. Il formato `SurfaceLink` non contiene lunghezza, larghezza o percorso intermedio. L'editor impone la stessa adiacenza.

### Un limite geometrico concreto

La proiezione attuale mantiene X e sottrae alla Y della mappa 16 px per quota. Il profilo della salita è `s(t) = 3t² − 2t³`.

| Direzione dal basso all'alto | Separazione degli estremi sullo schermo |
|---|---|
| Nord | 48 + 16 × dislivello px verticali |
| Est / Ovest | 48 px orizzontali e 16 × dislivello px verticali |
| Sud | 48 − 16 × dislivello px verticali |

Con tre quote di dislivello, una scala diretta verso sud ha gli estremi sovrapposti. Sopra tre, l'ordine degli estremi si inverte. Il profilo si ripiega già sopra due quote, perché nel suo tratto più ripido la variazione proiettata è `48 − 24 × dislivello`.

I test geometrici esistenti verificano estremi e coordinate finite anche per scale alte, ma non questa monotonia. La presenza di test verdi non risolve il limite di proiezione.

Inoltre la scala disegnata è larga 30 px, l'apertura è larga 34 px e il collegamento logico opera sul bordo da 48 px: il passaggio fisico non viene ristretto alla fascia disegnata. La quota visiva viene campionata lungo l'asse anche fuori da quella fascia. Apertura, gradini e collisioni devono derivare dalla stessa geometria.

## Integrazione consigliata

Questa sezione propone il lavoro successivo; non descrive una funzione già implementata.

### 1. Una scala con ingombro proprio

Rappresentare almeno: ingresso, uscita, quota bassa, quota alta, percorso in pianta, larghezza utile, pianerottoli e famiglia di asset. Il percorso e il dislivello restano indipendenti.

Gli editor possono selezionare estremi distanti più celle e mostrare l'intero corridoio prima della posa. Occorre verificare ostacoli, intersezioni con altre scale, spazio ai pianerottoli, apertura nella parete e continuità del supporto superiore. La posa completa deve essere una sola operazione annullabile.

### 2. Scegliere la corsa dal profilo dell'asset

Per un asset laterale con rapporto salita/corsa pari a 1/2, una parete alta 48 px richiede 96 px di tratto inclinato, cioè due tile Riftlands. Una parete alta 96 px richiede quattro tile. Pianerottoli ed eventuali spalle si aggiungono all'ingombro.

Seguendo invece le proporzioni laterali 1:1 misurate nei pezzi blu allegati, la stessa salita grafica da 48 px richiede circa 48 px di sviluppo orizzontale; una salita da 96 px ne richiede 96. È una conversione delle proporzioni grafiche, non un'autorizzazione a ridurre l'intero corridoio e i raccordi a una sola cella.

Questo rapporto è una scelta basata su quella famiglia grafica, non una legge di tutte le scale né una misura certificata dei pezzi blu del JPG. Le scale frontali richiedono un profilo proprio.

Se si mantiene lo smoothstep globale e si estende la corsa a N tile, la salita verso sud richiede `48 × N > 24 × dislivello` per non ripiegarsi. Per tre quote bastano almeno due tile secondo questo vincolo. È una condizione di proiezione; possono servire più spazio o un profilo diverso per far combaciare i gradini dell'asset.

### 3. Aprire la parete con la stessa sagoma della scala

La scala attraversa la faccia rocciosa e sostituisce il tratto necessario. Il bordo superiore termina ai lati dell'accesso; la sommità continua sul pianerottolo. Non si disegna prima una parete intera e poi una scala sovrapposta: quel procedimento può lasciare roccia nel corridoio.

Sommità, corpo, piede, gradini e spalle devono condividere orientamento e illuminazione. Le pedate mantengono dimensioni leggibili; i dislivelli maggiori aggiungono gradini e corsa invece di stirare l'intera scala. Il numero delle piccole alzate grafiche non equivale al numero delle quote logiche.

### 4. Un percorso condiviso fra disegno e fisica

Dal percorso della scala si derivano corridoio percorribile, maschera della parete e quota visiva lungo la salita. Piedi, ombra e camera usano lo stesso parametro di avanzamento. Anche la posizione laterale va verificata, considerando il raggio dell'attore rispetto alla larghezza utile.

I collegamenti adiacenti per A* e per il server possono essere generati dal percorso, conservando l'architettura esistente. Le celle intermedie partecipano alla scala: un unico link fra estremi lontani non basta. La distribuzione delle quote intere va definita insieme alla politica di combattimento e interazioni durante il transito; la sola interpolazione visiva non costituisce un supporto fisico continuo.

La presentazione deve seguire l'intera rampa, non ricominciare lo smoothstep a ogni giunto: altrimenti una scala lunga assume una salita a onde. Non si deve prendere la Y disegnata come prova del piano fisico, soprattutto sotto i ponti.

### 5. Conservare la scala delle mappe esistenti

Non cambiare globalmente `ELEVATION_STEP` da 16 a 48 per ottenere «un livello = un tile»: altererebbe pareti, attori, ponti ed editor già costruiti. Se utile, l'interfaccia può chiamare «fascia completa» un gruppo di tre quote mantenendo i dati originali. Eventuali cambi di unità richiedono una migrazione esplicita.

## Verifiche richieste prima dell'integrazione

- Accessi e uscite coerenti nelle quattro direzioni, anche invertendo l'ordine dei click.
- Corsa da uno, due e più tile con dislivelli piccoli e grandi, distinguendo lunghezza inclinata e pianerottoli.
- Proiezione senza ripiegamenti o pedate sovrapposte nelle combinazioni consentite.
- Collisioni della fascia utile, delle spalle e del muro; impossibilità di entrare lateralmente dalla parete.
- Salita e discesa di giocatori e NPC, inclusi arresto e inversione a metà rampa.
- Piedi e camera continui attraverso più celle, predizione coerente con il server e ripristino dopo teleport.
- Scale che raggiungono un ponte con personaggi e oggetti sottostanti distinti.
- Persistenza, esportazione, ricollocazione e undo dell'intera costruzione.

La prima prova adatta è una terrazza con parete alta 48 px, scala frontale e scala laterale da due tile di corsa, più una terrazza doppia con una scala più lunga. Consente di verificare l'integrazione prima di estenderla a tutti i materiali e a tutte le conformazioni.

## Verifica svolta durante lo studio

Gli otto test esistenti in `tests/rock-cliff-geometry.test.ts` e `tests/surface-presentation.test.ts` passano. Il controllo diagnostico `artifacts/stairs-projection-check.ts` usa la geometria reale e conferma, per la salita verso sud, separazione degli estremi pari a 0 px con tre quote e −16 px con quattro. Con tre quote rileva anche intervalli negativi fra campioni consecutivi del corridoio: il ripiegamento non è soltanto un'ipotesi sul disegno.

Queste verifiche fotografano l'implementazione attuale. Non è stata realizzata né validata l'integrazione proposta.
