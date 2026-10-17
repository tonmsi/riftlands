# Coste naturali nel World Maker

In **Painting → Acqua · costa naturale** si possono modificare:

- attivazione dell'intero effetto e, separatamente, delle curve automatiche;
- continuità delle curve, ampiezza, scala spaziale e seed del rumore;
- larghezza (0–128), intensità e livelli (1–32) della sfumatura della riva;
- larghezza (0–512), intensità, colore e livelli (1–32) dell'acqua bassa;
- attivazione, escursione (0–128), velocità, randomizzazione e seed del movimento;
- numero delle fasce animate (0–12), ciascuna con ampiezza (0–512), colore, opacità e livelli di sfumatura (1–16) indipendenti.

Le modifiche hanno anteprima sulla mappa, annullamento e ripristino, salvataggio nel progetto ed esportazione/importazione. Il pulsante di ripristino della costa riguarda solo questi parametri. I colori dei materiali e le macchie pittoriche restano nei controlli Painting esistenti. La sfumatura della riva usa il colore del materiale adiacente.

Le curve automatiche ricavano la direzione della costa da un intorno 4×4, conservando le 16 combinazioni della griglia duale. Non si tratta di un atlante di 65.536 maschere. Il rumore è deterministico nelle coordinate del mondo e varia lentamente nello spazio; estremi e tangenti sono condivisi fra le celle. Gli estremi adiacenti a una maschera manuale rimangono fissi. Una maschera modificata a mano, anche ereditata dalla regola generale o di materiale, prevale sulla curva automatica per quella combinazione. Disattivando le curve automatiche si possono usare le maschere esistenti mantenendo le sfumature.

L'acqua resta uno sfondo continuo sotto la terra. I bordi e le sfumature statiche sono disegnati nella stessa cache bitmap del terreno. Le fasce animate vengono sovrapposte usando i contorni vettoriali già preparati e ritagliate sul solo lato dell'acqua. Le ampiezze indicano la profondità della fascia a partire dalla costa: fasce di ampiezza diversa si sovrappongono creando livelli di colore, con la fascia più stretta sopra. Il movimento amplia e restringe le fasce senza modificare la terra. La randomizzazione miscela oscillazioni regolari con ritmi e fasi diversi per fascia; non sposta i punti delle maschere e non campiona rumore nuovo a ogni fotogramma.

Non ci sono nuove superfici bitmap o modifiche a collisioni e generazione dei biomi. Le cache vettoriali statiche sono limitate a 512 patch, 1.024 gradienti e 2.048 verifiche di adiacenza; i contorni manuali usano una WeakMap delle regole risolte. L'animazione conserva al massimo 32.768 patch vettoriali, rimuove quelle fuori dall'area disegnata e ricompone i tracciati quando cambia l'area della cache. Il World Maker mostra l'animazione anche a camera ferma in Painting, da 12 px/cella, con lo stesso meccanismo di aggiornamento delle altre anteprime animate.

I valori iniziali usano due fasce con tre livelli ciascuna. Una fascia con ampiezza oppure opacità zero non viene disegnata; con zero fasce o movimento disattivato non c'è sovrapposizione. Velocità o escursione zero fermano le fasce, che rimangono visibili. Il pannello indica il numero di passaggi di disegno della configurazione. Ampiezze elevate, molti livelli e molte fasce contemporaneamente aumentano il costo. Per le fasce ampie si raccolgono anche le coste fuori schermo abbastanza vicine da raggiungere l'area visibile: questo evita tagli della sfumatura durante lo scorrimento e nell'editor.

## Verifica locale del 17 ottobre 2026

Prima verifica delle sole coste statiche: Chrome headless, Canvas CPU, scena di un lago a 960×640 e DPR 1; 20 disegni del terreno dopo il riscaldamento e 120 chiamate alla cache con piccoli spostamenti della camera.

| Misura | Effetto disattivato | Effetto attivato |
| --- | ---: | ---: |
| Disegno terreno, mediana CPU | 1,1 ms | 1,1 ms |
| Disegno terreno, P95 CPU | 1,6 ms | 1,3 ms |
| Ricostruzioni nelle 120 chiamate con cache valida | 0 | 0 |
| Pixel della bitmap di cache | 1.378.625 | 1.378.625 |
| Canvas aggiuntivi per le coste | 0 | 0 |

Nella scena sono state compilate 68 patch e 204 gradienti. La precisione del timer sulle chiamate con cache valida non permette confronti utili inferiori al millisecondo. Questi numeri misurano l'invio CPU del solo terreno; non misurano il completamento GPU, RAM/VRAM residente o il frame del gioco completo.

Le misure iniziali delle coste precedono la preparazione anticipata del terreno: ricostruzioni e fasce potevano superare il budget del frame. La soluzione attuale, la memoria della seconda bitmap e la conferma sul telefono sono documentate in [Prestazioni del client](performance.md). Le tabelle di questa pagina descrivono soltanto gli effetti costieri nelle scene di prova indicate.

## Misura del movimento

Scena separata con costa orizzontale, 1280×720, DPR 1, contesto Canvas con `willReadFrequently`. Trenta disegni dopo il riscaldamento, ognuno seguito dalla lettura sincrona di un pixel per includere il lavoro Canvas differito. La lettura aggiunge un proprio costo; non è una misura del frame completo del gioco o della GPU in condizioni normali.

| Configurazione | Mediana | P95 |
| --- | ---: | ---: |
| Movimento disattivato | 0,3 ms | 0,5 ms |
| Due fasce, tre livelli, escursione 8 | 0,8 ms | 1,3 ms |
| Dodici fasce, sedici livelli, ampiezze 292–512, escursione 128 | 48,2 ms | 50,9 ms |

Le impostazioni estreme non mantengono 60 fps in questo test. Con molte coste procedurali aggiuntive nella fascia fuori schermo, una prova precedente ai valori massimi ha superato 200 ms di mediana: il costo dipende anche dalla complessità del contorno. La configurazione leggera rimane quella iniziale; il test usa escursione 8 per rendere evidente il movimento, mentre il valore iniziale è 3. Non si deve dedurre costo nullo dai soli tempi di invio CPU, che nel test piccolo sono inferiori a 0,1 ms. Nessuna delle 120 chiamate con cache valida ha ricostruito il terreno o cambiato i suoi pixel; la nuova animazione aggiunge soltanto vettori e lavoro di disegno. Lo scorrimento confrontato con una ricostruzione completa allo stesso istante ha prodotto immagini identiche nella scena orizzontale.

Verificati anche: rumore statico identico fra disegni successivi, continuità fra colonne di pixel, rispetto delle maschere manuali, gradiente sulla sola acqua, cache limitate, seed riproducibile, controlli di arresto, fasce più ampie e animazione nel World Maker a camera ferma. I dati vengono scritti da `tests/integration/water-coast.test.ts` in `artifacts/water-coast-performance.json` e da `tests/integration/coast-motion.test.ts` in `artifacts/coast-motion-performance.json`. Le anteprime sono in `artifacts/water-coast-preview.png` e `artifacts/coast-motion-preview.png`.

Comandi di verifica: `npm test`, `npm run build` e `npx tsx --test --test-concurrency=1 tests/integration/water-coast.test.ts tests/integration/coast-motion.test.ts tests/integration/world-painting.test.ts tests/integration/terrain-browser.test.ts`. I test browser chiudono i server temporanei in `finally`.
