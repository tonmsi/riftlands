# Prestazioni del client e transizioni

Stato verificato il 17 ottobre 2026. Questo documento sostituisce i resoconti intermedi di World Painting, del primo intervento sul terreno usando il cacciatore (che è veloce per developer) e del prototipo di preparazione anticipata. La [guida diagnostica](performance-diagnostics.md) descrive gli strumenti disponibili solo in sviluppo.

## Problema osservato

Sul telefono gli scatti comparivano soprattutto camminando verso terreno nuovo, anche con tempo sereno. Il terreno era già conservato in una bitmap scorrevole, ma superarne il margine richiedeva nello stesso frame la copia della bitmap e il disegno delle nuove fasce: campioni del mondo, geometrie delle maschere, materiali, macchie e oggetti ambientali. A 60 FPS il budget dell'intero frame è circa 16,7 ms.

Nel primo report telefonico le fasce richiedevano mediamente 20,4 ms, con un massimo di 38,3 ms; le maschere arrivavano a 26,8 ms. I frame normali erano molto più economici. Il problema non era quindi soltanto la quantità di lavoro media, ma la sua concentrazione durante lo scorrimento. Anche senza mare e maschere restavano aggiornamenti del terreno costosi.

Il confronto sullo stesso telefono con le quattro combinazioni, a 60 FPS e tempo sereno, ha dato:

| Mare | Maschere | FPS medi | Intervalli oltre 25 ms |
| ---- | -------- | -------: | ---------------------: |
| ON   | ON       |    58,30 |                     34 |
| OFF  | ON       |    58,77 |                     25 |
| ON   | OFF      |    59,66 |                      8 |
| OFF  | OFF      |    59,71 |                      6 |

Registrazioni di circa 20–23 secondi, una per combinazione: indicano un peggioramento soprattutto con le maschere, senza isolare ogni causa. Numero di attori visibili, percorso preciso, cache e scheduling del browser possono differire. Il costo Canvas differito non è interamente visibile nei tempi delle chiamate JS.

## Modifiche applicate

- I quadrati con quattro campioni dello stesso materiale usano rettangoli diretti, evitando risoluzione di transizioni e copie di maschere. Le zone completamente acquatiche vengono unite in segmenti di riga per il ritaglio del mare animato.
- Campioni di superficie e colore: massimo 8.192 ciascuno; temperatura: massimo 4.096. Cambi di mondo, terreno, configurazione pittorica e blocchi dei dungeon invalidano le cache. Anche macchie dell'acqua e geometrie costiere rispettano queste revisioni.
- Quando un aggiornamento scorrevole impiega almeno 10 ms CPU, si abilita la preparazione anticipata. Il primo caricamento e la rasterizzazione iniziale delle texture non attivano da soli questa modalità. Sui dispositivi dove il percorso diretto è economico viene mantenuto.
- Avvicinandosi a 128 unità dal bordo, una seconda bitmap anticipa la direzione della camera su entrambi gli assi. Le fasce vengono divise in porzioni con lato lungo massimo di 256 pixel fisici; normalmente se ne prepara una per frame. La bitmap visibile viene sostituita solo quando quella nuova è completa.
- Il mare visibile conserva il suo ritaglio durante la preparazione della seconda bitmap. Le maschere usano il margine necessario alle coste, mentre gli oggetti ambientali mantengono il proprio margine per le immagini sporgenti.

Si tratta di preparazione distribuita sul thread principale: **nessun Web Worker è attualmente implementato**. Il limite è geometrico, non una garanzia temporale, perché una chiamata Canvas non può essere interrotta. Un teletrasporto o una preparazione arrivata in ritardo usa ancora un percorso sincrono per evitare aree vuote.

La memoria è limitata a due bitmap del terreno, con riuso della seconda. Nel viewport del telefono dei report quella aggiuntiva contiene 1.485.336 pixel, circa 5,94 MB RGBA. Nel viewport desktop del benchmark sono circa 10,44 MB aggiuntivi. Sono stime dei dati RGBA, non misure di RAM/VRAM residente. Annullamento, cambio mondo/configurazione, ripristino del contesto e distruzione rilasciano o ricostruiscono le risorse pertinenti. Generazione, collisioni e velocità del cacciatore (610 unità/s) restano invariate.

## Conferma sul telefono

Report `riftlands-performance-2026-10-17T12-16-34-592Z.json`, circa 21,1 secondi, mare e maschere ON:

| Misura                           |    Risultato |
| -------------------------------- | -----------: |
| FPS medi                         |        59,96 |
| Intervallo frame P99             |      16,8 ms |
| Intervallo massimo               |      33,3 ms |
| CPU frame P99                    |       7,0 ms |
| Porzione anticipata, media       |      1,71 ms |
| Porzione anticipata, P95         |       3,5 ms |
| Porzione anticipata, massimo     |       7,3 ms |
| Preparazioni arrivate in ritardo | 0 nel report |

L'unico frame CPU oltre 16,7 ms è a circa 0,99 secondi: 22,4 ms totali, di cui 18,5 ms per il primo scorrimento che attiva il comportamento adattivo. Il contatore finale riporta 51 scambi di bitmap. Il giocatore conferma una fluidità sensibilmente migliore. È una verifica positiva sul dispositivo interessato, non una garanzia universale per ogni mappa o telefono.

## NPC: costo separato dal terreno

Il benchmark controllato usa 0, 10, 30 e 60 NPC misti (slime, wisp, sentinel), con il cacciatore. Il server esegue la simulazione reale, inclusi AI e combattimento. Il client mantiene tutti gli NPC visibili su terreno già preparato, con interpolazione reale e piccole variazioni delle posizioni; isola il disegno degli attori, senza proiettili o effetti di un combattimento completo.

| NPC | Tick server medio | Viewport mobile: invio rendering | Viewport mobile: rendering + readback | Viewport desktop: rendering + readback |
| --- | ----------------: | -------------------------------: | ------------------------------------: | -------------------------------------: |
| 0   |          0,007 ms |                          0,07 ms |                               0,83 ms |                                4,65 ms |
| 10  |          0,087 ms |                          0,12 ms |                               3,27 ms |                               16,54 ms |
| 30  |          0,289 ms |                          0,60 ms |                              12,41 ms |                               23,55 ms |
| 60  |          0,647 ms |                          1,38 ms |                              26,02 ms |                               31,39 ms |

Entrambi i viewport girano in Chrome sul PC, con Canvas CPU: **non sono FPS su telefono**. La lettura sincrona di un pixel forza il lavoro differito ma aggiunge sincronizzazione e varia sensibilmente tra esecuzioni. A 60 NPC l'interpolazione media è 0,124 ms nel viewport mobile e 0,156 ms nel desktop. Il confronto evidenzia un costo grafico crescente anche senza aggiornare il terreno; non certifica una capacità massima di NPC né individua ancora la singola operazione grafica responsabile.

## Respawn

Il client riconosce il passaggio morto → vivo e l'aumento del numero di morti tra snapshot. Mantiene ferma la camera mentre compare una copertura nera di 160 ms; a schermo coperto sposta direttamente la camera e disegna il terreno di destinazione. Dopo il rendering mantiene il nero almeno 60 ms, poi rivela la scena in 160 ms. Con movimento ridotto le dissolvenze sono immediate. Il server mantiene le proprie regole di morte e rinascita.

Gli input vengono rilasciati e bloccati durante la transizione; non si percorrono né si generano graficamente i punti intermedi tra morte e rinascita. Uscita, disconnessione e cambio stanza annullano la copertura. La ricostruzione di destinazione può ancora essere sincrona, ma avviene sotto il nero.

## Diagnostica e personalizzazione

Nel gioco normale non ci sono contatore FPS, pannello diagnostico o comandi A/B, e non parte la registrazione. Il pannello viene caricato su richiesta solo con build di sviluppo e `/?diagnostics=1`; il registratore e i test restano disponibili per regressioni future. Il limite FPS nelle impostazioni è una preferenza di gioco e viene conservato. In World Maker restano i livelli grafici Mare/Maschere e tutte le personalizzazioni di colori, contorni, macchie e coste.

## Miglioramenti ulteriori da misurare

1. Ridurre il primo scorrimento costoso che attiva la modalità adattiva, per esempio preparando una fascia iniziale durante il caricamento. Non abilitare sempre la suddivisione senza misurarne l'overhead sui dispositivi rapidi.
2. Se restano picchi, portare la preparazione di piccoli blocchi in un Web Worker con `OffscreenCanvas`, trasferimento `ImageBitmap`, coda limitata e scarto dei risultati obsoleti. Servono supporto del browser e un fallback; non elimina il costo GPU o le copie e richiede adattare i generatori che usano il DOM.
3. Per scene affollate misurare separatamente sprite, nomi/barre ed effetti, poi valutare rasterizzazioni riutilizzabili e dettaglio visivo graduato. Non ridurre AI o quantità di NPC sulla sola base del microbenchmark grafico.
4. Misurare memoria delle texture pittoriche e costo GPU con strumenti del browser. Valutare una cache a blocchi limitata solo se migliora anche riuso, copie e costo complessivo rispetto alle due bitmap attuali.

## Verifica riproducibile

```powershell
npm test
npm run build
npx tsx --test --test-concurrency=1 tests/integration/terrain-prefetch.test.ts tests/integration/terrain-browser.test.ts tests/integration/coast-motion.test.ts tests/integration/respawn-browser.test.ts tests/integration/performance-browser.test.ts
npx tsx --test tests/integration/hunter-terrain-performance.test.ts
npx tsx --test tests/integration/npc-performance.test.ts
```

Eseguire i benchmark senza altri test browser concorrenti. Il replay del cacciatore dura 720 frame e ignora le collisioni: serve a stressare il rendering, non descrive un percorso giocabile. `HUNTER_PREFETCH=always` forza la preparazione per confronti tecnici; il comportamento predefinito è adattivo. Il test dedicato verifica inversione di marcia, pixel rispetto a rendering completo, annullamento, teletrasporto e rilascio memoria. Quello del respawn prova anche movimento ridotto e camera ferma prima del nero. Tutti i server e browser temporanei vengono chiusi in `finally`; i risultati locali sono scritti in `artifacts/`.
