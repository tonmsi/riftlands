# Prima ottimizzazione del movimento mobile — 13 ottobre 2026

Il movimento sul telefono presentava scatti anche durante la normale esplorazione. Il renderer eseguiva lavoro inutile sugli asset e sulle superfici statiche, con picchi quando la camera usciva dalla cache del terreno.

## Modifiche

- Canvas del mondo touch con DPR massimo 1,25 anziché 1,5: circa 31% di pixel in meno alle densità elevate. HUD e visuale logica conservano dimensioni e coordinate.
- Asset fuori dall'area visibile esclusi usando i limiti reali dell'immagine, inclusi overflow e quota. Gli asset normali evitano calcoli di fade e di supporto dei personaggi.
- Ground sopraelevato rasterizzato e riutilizzato per piano; cache limitata a 8 immagini e 3 milioni di pixel totali, con fallback sulle scene sparse enormi. Ponti, finestre di visibilità e parti che coprono gli attori restano dinamici.
- Il terreno di base del gioco evita di dipingere una seconda volta i piani sopraelevati. I percorsi degli editor e la pittura diretta mantengono il comportamento precedente.
- Scale e collegamenti fuori vista esclusi dal passaggio grafico.
- Scorrimento del terreno con due buffer per evitare di copiare un canvas su se stesso. Cambio mondo, modifica, dimensioni e ripristino del contesto invalidano le cache.
- Lo zoom pesca mantiene stabile la risoluzione della cache e si arresta con una soglia: non ricostruisce più l'intero terreno a ogni frame.

È stata provata anche una preparazione anticipata del terreno a piccole strisce: aumentava il lavoro complessivo e il p95, quindi è stata rimossa.

## Misura del movimento

Edge headless, viewport touch 844×390, DPR dispositivo emulato 3, CPU rallentata 4 volte, 240 frame cadenzati con requestAnimationFrame. Lo stesso giocatore si sposta di 3 unità X e 1 Y per frame a partire dallo spawn corrente. Misure CPU della chiamata render; non sono FPS certificati su un telefono.

| Misura | Prima | Dopo |
| --- | ---: | ---: |
| Mediana | 16,8 ms | 11,3 ms |
| p95 | 32,5 ms | 24,6 ms |
| Frame oltre 16,67 ms | 120/240 | 33/240 |
| Frame oltre 50 ms | 4/240 | 6/240 |
| Picco | 245,3 ms | 213,9 ms |

La mediana migliora di circa il 33%, il p95 di circa il 24%. Restano pochi picchi e la frequenza dei frame oltre 50 ms non migliora in questa esecuzione: il risultato non garantisce assenza di scatti. Il rinnovo del terreno è il prossimo costo da affrontare se la prova fisica resta insoddisfacente. La nuova cache per piano riduce CPU ma aggiunge bitmap limitate; non è una misura della memoria effettiva del browser.

I dati sono in `artifacts/code-review-2026-10-13/movement-before-paced.json` e `movement-after-double-buffer.json`. Probe: `node artifacts/code-review-2026-10-13/movement-probe.mjs nome-output`. Non eseguire benchmark contemporaneamente ai test browser: una prova concorrente ha mostrato forte interferenza e non è stata usata per il confronto.

## Verifica e prova sul telefono

Build TypeScript/Vite superata; 9 test unitari mirati e 5 test browser superati. Test dedicato alla cache: zoom pesca senza ricostruzioni, modifica del mondo che invalida entrambi i piani, picking corretto e rilascio delle bitmap. Test esistenti su movimento lungo le scale, passaggi sopra/sotto, ponti trasparenti, terreno scorrevole e ripristino del contesto. Il test completo degli asset ha superato la verifica isolata; nella prova concorrente precedente era scaduto.

Per riprovare, ricaricare la pagina del gioco sul telefono. In modalità produzione usare la nuova build; il progetto è stato compilato dopo le modifiche. Misurare lo stesso tratto del mondo prima di cambiare zoom o orientamento, così il confronto rimane utile.

## Secondo intervento: scorrimento e cadenza

Il telefono di prova dell'utente è un Nothing Phone 1. L'aggiornamento di Chrome ha ripristinato il menu, ma il movimento resta a scatti. La cache touch del terreno ora conserva blocchi raster da 128×128 pixel e prepara al massimo un blocco fuori vista per frame, anticipando la direzione della camera. Evita il rinnovo di grandi strisce tutte insieme. La cache conserva al massimo 128 blocchi (circa 8 MiB di pixel, escluso l'overhead del browser); i viewport troppo grandi usano il percorso precedente. Teletrasporti possono richiedere più blocchi immediati. Modifiche del mondo e cambio risoluzione invalidano la cache.

I pannelli touch non applicano più backdrop-filter al mondo in movimento. In Impostazioni → Prestazioni mobile → Fluidità sono disponibili Automatica, 60 FPS e 30 FPS stabili. Automatica parte a 60 e passa a 30 quando almeno 18 dei 60 intervalli osservati superano 24 ms; resta a 30 fino al reset della sessione di misura (menu o scheda nascosta). La lettura dei comandi e l'invio di input restano indipendenti dal rendering.

Stesso probe con CPU rallentata 4 volte, eseguito senza test concorrenti:

| Misura | Prima del secondo intervento | Cache a blocchi |
| --- | ---: | ---: |
| Mediana | 10,5 ms | 10,9 ms |
| p95 | 25,6 ms | 25,1 ms |
| Picco | 167 ms | 43 ms |
| Frame oltre 50 ms | 3/240 | 0/240 |

Il miglioramento riguarda soprattutto i picchi; il costo medio non migliora. Il probe misura la CPU del renderer, non il compositing CSS o la modalità automatica del client completo, e non sostituisce una prova sul telefono. Dati: `scrolling-before.json` e `scrolling-after-halo.json` nella cartella artifacts del primo audit.

Le verifiche dedicate confrontano i pixel della cache a blocchi col terreno completo durante movimento in più direzioni, coordinate negative, cambi di terreno e invalidazione; controllano anche limite e rilascio delle bitmap. Il test delle impostazioni verifica selezione e persistenza dei 30 FPS e assenza di blur touch. Sono coperti anche zoom pesca, movimento sulle superfici e comportamento del regolatore automatico.
