# Pareti rocciose e gradoni

## Risultato utilizzabile

Il kit è in `public/terrain-textures/rock-cliffs-v1`. Il manifest descrive i rettangoli sorgente, la scala nel mondo e le conformazioni supportate. Le immagini originali nelle cartelle `alture` e `montagna` non sono state modificate.

Negli editor scegli **Bordi e pareti → Roccia naturale**. Il terreno mantiene il materiale superiore scelto; il bordo roccioso usa ora l'illustrazione fornita. Le pareti in terra, mattoni, pietra lavorata e legno conservano i rispettivi renderer. Il lavoro non cambia ponti, collisioni, navigazione o formato delle mappe.

**Scala** riconosce la parete rocciosa al piano superiore e usa pedate larghe, alzate scure, piccoli bordi laterali e pianerottolo. I gradini sono proiettati uno per uno: i frontali rimangono orizzontali, i laterali mantengono gli spigoli verticali. Il collegamento funziona in entrambi i sensi. La salita dei piedi e della camera continua a usare l'interpolazione condivisa con il gioco.

La bozza **Prova · pareti rocciose e gradoni** è disponibile in **Copia da catalogo** nel Dungeon Maker. Nel laboratorio `/surface-lab.html`, il menu **Esempio** offre la stessa prova giocabile e scaricabile. Non viene installata automaticamente nel progetto.

## Analisi delle 28 immagini

I nove asset di `C:/Users/tomma/Desktop/alture` condividono roccia grigio-blu sfaccettata, prato verde oliva, crepe scure e illuminazione alta/sinistra. La camera è quasi ortografica, con la faccia frontale più visibile dei fianchi. Sono oggetti e forme complete, non una griglia di tile già allineati.

I diciannove file di `public/world-assets/montagna` comprendono una seconda famiglia leggermente più calda, gradoni di roccia, angoli, una grotta e forme ambientali. Due immagini sono riferimenti opachi estranei al kit di scarpate: una mappa Pokémon completa e una texture di lastre regolari.

| Cartella | File | Valutazione e uso |
|---|---|---|
| alture | Anello Roccioso Erboso Cavo.png | Riferimento principale per cavità, parete interna, bordo esterno e raccordi fra i due. Il grande foro centrale e i quattro lati non sono un tile ripetibile. |
| alture | Immagine ChatGPT 13 ott 2026, 00_57_28-1.png | Plateau quadrato compatto; utile per angoli convessi e raccordo erba/roccia. La faccia include la sua base e ombra. |
| alture | Immagine ChatGPT 13 ott 2026, 00_57_29-2.png | Forma a U; riferimento per due rientranze e spalle rocciose. Evitare di stirare tutta la U per creare una parete. |
| alture | Immagine ChatGPT 13 ott 2026, 00_57_30-3.png | **Donatore principale**: parete frontale lunga e regolare. Sono separati corpo minerale, raccordo erboso e piede. Buona scala dei massi, luce coerente. |
| alture | Immagine ChatGPT 13 ott 2026, 00_57_30-4.png | Plateau tondeggiante; riferimento per graduale curvatura e fronte alto. Non adatto a un riempimento rettangolare. |
| alture | Immagine ChatGPT 13 ott 2026, 00_57_31-5.png | Forma a T; riferimento per raccordi interni e spalla che avanza. |
| alture | Immagine ChatGPT 13 ott 2026, 00_57_33-7.png | Piccola doppia spalla con sella; adatta come riferimento per pareti brevi e giunti stretti. L'ingombro grafico è molto piccolo rispetto al PNG. |
| alture | Immagine ChatGPT 13 ott 2026, 00_57_33-8.png | Piccolo plateau arrotondato; riferimento per pilastri e collinette isolate. |
| alture | Immagine ChatGPT 13 ott 2026, 00_57_34-9.png | Fronte verticale singolo, massi leggibili e quasi niente terreno superiore. Utile come campione di scala, crepe e luce del corpo minerale. |
| montagna | 0ze5tbpuenah1.png | Mappa Pokémon verticale completa, opaca: riferimento di layout, esclusa dai materiali di produzione. |
| montagna | 28a5ac431ac4046586911b9765dcebe0.jpg | Lastre quadrate regolari, opache: materiale costruito, non parete rocciosa naturale. |
| montagna | Immagine ChatGPT 11 ott 2026, 21_01_59-1.png | Lunga scarpata laterale sinistra; buon riferimento di bordo, ma la prospettiva non va trapiantata interamente sul piano del gioco. |
| montagna | Immagine ChatGPT 11 ott 2026, 21_01_59-2.png | Variante laterale destra; conserva l'illuminazione, quindi è preferibile al semplice specchio del lato sinistro. |
| montagna | Immagine ChatGPT 11 ott 2026, 21_02_28-1.png | Tre livelli decrescenti; riferimento per cambi di altezza e mantenimento della dimensione dei massi. |
| montagna | Immagine ChatGPT 11 ott 2026, 21_02_30-2.png | Angolo con spalla alta; riferimento per convessità e raccordo fra parete bassa e alta. |
| montagna | Immagine ChatGPT 11 ott 2026, 21_02_33-3.png | Parete a gradoni angolata: la faccia e la fascia erbosa variano insieme. Utile per verificare le terrazze. |
| montagna | Immagine ChatGPT 11 ott 2026, 21_02_34-4.png | Fronte scalare più largo; riferimento per giunti fra quote diverse, non una scala percorribile. |
| montagna | Immagine ChatGPT 11 ott 2026, 21_02_36-5.png | Roccia che sale da un piede molto basso; utile per transizioni e piccoli accumuli di pietre. |
| montagna | Immagine ChatGPT 11 ott 2026, 21_02_38-6.png | Gradoni frontali e laterali; utile per raccordi di altezza e sagoma del piede. |
| montagna | Immagine ChatGPT 11 ott 2026, 21_06_38-1.png | Angolo a L con lato alto, fronte corto: riferimento per spigoli esterni. |
| montagna | Immagine ChatGPT 11 ott 2026, 21_06_38-2.png | Variante a L opposta; utile per conservare una luce coerente sui due orientamenti. |
| montagna | Ingresso della Grotta sulla Scogliera.png | Composizione speciale con arco e foro. Conservata come decorazione; la grotta richiede un proprio asset/ingresso, non va ripetuta su ogni parete. |
| montagna | Isola montuosa terrazzata cel-shading.png | Ottimo riferimento globale per anelli, terrazze e alternanza roccia/prato. Scala dei massi diversa: non incollata come modulo di muro. |
| montagna | Piattaforma rocciosa in pietra sfaccettata.png | Campione quasi pieno di grandi massi; vicino a roccia-tile ma con trasparenza al margine. Usabile come riferimento minerale, non già perfettamente ripetibile. |
| montagna | Plateau Roccioso Isometrico con Erba.png | Plateau a due livelli; utile per una terrazza arrotondata, con profondità prospettica superiore al motore attuale. |
| montagna | roccia-tile.png | Campione di roccia sfaccettata simile alla piattaforma precedente. Il margine inferiore è parzialmente trasparente: non trattato come texture opaca seamless. |
| montagna | Scogliera erbosa modulare sfaccettata.png | **Secondo donatore**: fascia frontale più erosa con pietre piccole e muschio. Usata per piede e variazioni sulle pareti alte. |
| montagna | tile-frastagliatA.png | Grossi massi irregolari e sagoma frastagliata; adatto a decorazione e riferimento per la roccia, troppo riconoscibile per ripetizione fitta. |

## Trasparenza, scala e giunti

I PNG dei due gruppi hanno alpha reale, salvo la mappa verticale opaca. Diversi contengono un alone e pixel con alpha molto basso fuori dalla sagoma; quasi tutti i pixel interni hanno alpha 252–253, anziché 255. Il bounding box di ogni pixel non nullo è quindi poco affidabile per tagliare un modulo. L'inventario numerico e i provini di tutte le immagini sono in `artifacts/cliff-analysis`.

Il renderer campiona rettangoli interni verificati e mette un corpo minerale opaco sotto l'illustrazione. Le facce non diventano trasparenti e non portano nella scena la grande ombra/aloni esterni dei PNG. La parete lunga è ancorata alle coordinate del mondo; i giunti del campione sono raccordati in una cache rettangolare e il corpo è ripetuto a scala costante, senza stirare un unico masso per tutta l'altezza. Le varianti erose vengono aggiunte in fasce sottili.

Le conformazioni derivano dalla geometria del terreno: fronte lungo, angolo convesso, rientranza concava, anello, L/T, terrazza e pilastro. Lo stesso corpo roccioso riempie le sagome e le pareti interne. Nel motore la quota si proietta verticalmente: sui lati est/ovest il fianco si legge tramite bordo e smusso, non introducendo una diversa camera isometrica.

## Reference aggiuntive per i gradoni

L'immagine allegata delle lastre guida proporzioni delle pedate, alzate scure e piccoli bordi laterali. Il suo motivo a scacchi è uno sfondo incorporato e non viene importato come trasparenza.

La reference [FR Sideways Stairs di Spherical Ice](https://www.pokecommunity.com/threads/fr-sideways-stairs.378934/) mostra la salita laterale con variazione di quota del personaggio. È stata usata come riferimento visivo e di comportamento; la routine ROM non è importata. I gradini di Riftlands restano collegati alle proprie superfici e all'interpolazione già condivisa da piedi e camera.

## Asset finali e generazione

| File | Provenienza / funzione |
|---|---|
| cliff-front-source.png | Copia invariata del donatore 00_57_30-3, usata dal manifest per corpo, sommità e piede. |
| cliff-weathered-source.png | Copia invariata di Scogliera erbosa modulare sfaccettata, usata per erosione e fasce di raccordo. |
| rock-steps-slab-atlas.png | Atlas nuovo, generato con il tool integrato ImageGen: pedata, alzata, pietra laterale e pianerottolo, seguendo le reference aggiuntive. |
| manifest.json | Rettangoli sorgente, scala e famiglia di conformazioni. Gli originali restano disponibili nelle cartelle dell'utente. |

La prima prova di scale complete è stata scartata dall'integrazione dopo l'arrivo della reference: aveva spalle rocciose troppo grandi. Il kit finale usa componenti piccoli che il renderer adatta alla direzione e al dislivello.

### Prompt finale usato con il tool integrato ImageGen

Input 1: `codex-clipboard-f7e42e39-c578-4c4d-b2e1-341f1a00ce5b.png`, costruzione dei gradoni. Input 2: `codex-clipboard-fac3586c-d2a2-4b83-bd42-5c87a2d8b811.png`, lettura laterale. Input 3: `Scogliera erbosa modulare sfaccettata.png`, roccia e palette. Background trasparente richiesto.

```text
Create ONE small modular stone-step sprite atlas for a 2D north-up RPG. Image 1 is the exact STEP CONSTRUCTION reference: flat broad slightly chipped stone pedestals, slim dark front risers, narrow quiet side stones, fine cracks and a hand-painted understated outline. Image 2 is the SIDEWAYS STAIR reading reference: narrow vertical edge/riser bars embedded into a cliff rather than a standalone mountain. Image 3 is the PALETTE and rock cliff context reference: muted gray/slate stone with warm light gray top planes. Match the believable warm-gray cut slabs of Image 1, cooled slightly to the slate-gray surrounding cliff of Image 3. Do not add grass, huge boulders, ornaments, railings, wooden planks or masonry brick. Genuine transparent background, never painted checkerboard. No labels, letters or grid borders. Square sheet in exactly 2 columns and 2 rows, four isolated pieces fully contained within their cell and separated with wide transparent gutters. TOP LEFT: one wide flat rectangular stone tread, seen from the same overhead oblique angle as Image 1, approximately 5:1 wide-to-high, with very thin shadowed front riser, subtle polygonal texture, one quiet hairline crack; no extruded tall sides. TOP RIGHT: one wide horizontal STEP FRONT/RISER strip, approximately 5:1 wide-to-high, dark muted gray face, irregular bevel highlight at its upper edge, two faint vertical cracks, roughly rectangular edges, fully opaque internally. BOTTOM LEFT: a short row of exactly four small side border stones in a vertical strip, as the slim side columns framing Image 1, simple flat gray tops, narrow dark bevels, no grass and no large boulder masses. BOTTOM RIGHT: a flat square stone LANDING tile with two subtle slab joints and a fine crack, no raised walls, no shadow outside it. Useful clean production cutout sprites, same consistent painted facets and upper-left lighting, restrained contrast, crisp silhouette, anti-alias only around outer edge. These are components to be projected by code into broad frontal treads and sideways stairs. Do not generate a complete freestanding staircase or a perspective scene.
```

## Verifiche

La scena di prova esercita tutti e quattro gli orientamenti, pareti lunghe, anelli, rientranze, terrazze e pilastri. I test verificano i livelli agli estremi della scala, direzioni indipendenti dall'ordine dei click, apertura della parete solo dove esiste un accesso, passaggio fisico nelle quattro direzioni e caricamento reale delle immagini. Il test browser controlla anche la demo scaricabile e la conservazione della mappa del progetto.
