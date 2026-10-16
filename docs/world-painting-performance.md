# World Painting: prestazioni

Misura locale del 17 ottobre 2026. Test: Chrome headless, Canvas CPU, viewport logica 1280×720, DPR 1,5. Quattro posizioni del mondo, 480 chiamate con cache valida e 32 scorrimenti per configurazione. Il caso di stress definisce tutte le sette regole di materiale e le 21 coppie, con otto punti per contorno in tutte le maschere; vengono compilate solo le regole incontrate nelle scene.

| Operazione | Generale | Tutte le regole |
| --- | ---: | ---: |
| Invio CPU con cache valida, media | 0.0046 ms | 0.0035 ms |
| Scorrimento, mediana | 3.10 ms | 3.60 ms |
| Scorrimento, percentile 95 | 5.70 ms | 8.00 ms |
| Ricostruzione completa, mediana | 19.00 ms | 16.70 ms |
| Ricostruzione completa, massimo del campione | 24.70 ms | 25.70 ms |
| Ricostruzioni nei 480 frame con cache valida | 0 | 0 |
| Superfici RGBA considerate | 74.19 MiB | 74.19 MiB |

## Interpretazione

Le nuove regole aggiungono geometrie, senza nuove bitmap o lavoro di risoluzione nei frame con cache valida. Nel campione di stress si usano 12 regole compilate e 252 tracciati. Il limite è 29 regole e 928 tracciati nel relativo archivio; la cache delle combinazioni è limitata dalle 91 combinazioni di due, tre o quattro superfici. Restano anche le 16 geometrie generali del riempimento di base. Cambiare soltanto contorni o priorità riutilizza ora anche sprite e macchie già rasterizzati; cambiare colori o parametri delle macchie invalida quelle risorse.

La memoria RGBA stimata include 7.9 MiB di canvas visibile, 15.8 MiB di cache terreno, 5.5 MiB di sprite ambientali e 45.0 MiB di texture delle macchie. È aritmetica sui pixel delle superfici del terreno, non una misura della RAM o VRAM residente: esclude copie del browser, attori, asset importati, audio, heap e altri sistemi. Le texture pittoriche sono la componente principale di questa stima.

I tempi sono invio CPU, non il completamento GPU né il frame completo del gioco. La precisione del timer è insufficiente per confrontare singole chiamate con cache valida; per questo si misura anche la media di un intero blocco di chiamate. Non si deduce che una configurazione sia più veloce dai massimi a freddo: ordine, inizializzazione del browser e contesa influenzano il campione. In esecuzioni precedenti sono comparsi outlier fino a circa 673 ms nella prima ricostruzione generale e 107 ms in uno scorrimento con le regole. La causa esatta di questi outlier non è stata profilata.

Il costo continuo del terreno è basso nelle scene provate; caricamento e ricostruzioni complete possono superare i 16,7 ms disponibili a 60 fps. I dati non certificano fluidità su ogni dispositivo o nel gioco completo. Gli interventi successivi più utili da misurare sono riduzione della memoria delle texture e distribuzione delle ricostruzioni pesanti, mantenendo questa cache.

## Riproduzione

Eseguire `npx tsx --test tests/integration/terrain-browser.test.ts`. Il test scrive il campione corrente in `artifacts/terrain-hardware.json` e chiude il server temporaneo nel blocco di pulizia. I test del maker verificano precedenze, contorni complementari, riuso delle texture, annullamento, esportazione e riapertura. Il file JSON è un artefatto locale e viene rigenerato a ogni esecuzione.
