# Diagnostica prestazioni su PC e telefono

Strumento per sviluppatori, conservato dopo la verifica sul telefono. **Nel gioco normale non sono montati pannello, pulsante FPS o comandi A/B.** Il registratore resta inattivo e non vengono avviati timer di campionamento o richieste `/health` della diagnostica. Le normali impostazioni del limite FPS rimangono disponibili e hanno stili indipendenti dal pannello.

Solo con server di sviluppo, aprire `/?diagnostics=1` per caricare il pannello su richiesta e avviare una registrazione di 60 secondi. In questo caso compaiono anche il contatore e i comandi di riapertura. La stessa query nella build di produzione non abilita gli strumenti. Il riepilogo del problema e della soluzione verificata è in [Prestazioni del client](performance.md).

## Procedura per riprodurre uno scatto

1. Sul server di sviluppo aprire `/?diagnostics=1` dal dispositivo interessato. La registrazione parte e il pannello si riduce a un contatore, lasciando disponibili i comandi del gioco. Per una seconda prova usare **Registra 60 secondi**.
2. Ripetere il percorso che scatta: camminare, fermarsi vicino all'acqua e osservare se il blocco coincide con lo scorrimento, l'ingresso in una zona o il meteo. Mantenere orientamento e zoom per rendere confrontabili le prove.
3. Dopo il problema aprire **Dettagli**, fermare la registrazione e scegliere **Scarica report JSON**. L'arresto è anche automatico dopo 60 secondi. Una pausa totale del thread ritarda il timer: il ritardo rimane nel log al ritorno dei frame.
4. Ripetere sul PC e sul telefono. I dati del browser con touch emulato sul PC verificano il funzionamento del registratore, non le prestazioni di un telefono reale.

Il contatore mostra la cadenza dei frame disegnati negli ultimi due secondi, distinta dal target. Il riepilogo finale riguarda l'intera porzione di registrazione conservata. A 60 FPS il budget è circa 16,7 ms per frame, a 30 FPS circa 33,3 ms. Gli intervalli registrati sono quelli reali: non usano il delta limitato della simulazione, quindi un blocco di 500 ms resta di 500 ms. Il tempo della scheda nascosta è escluso dai successivi intervalli.

## Cambiare il limite FPS

In **Impostazioni → Limite FPS in partita**, oppure nei dettagli della diagnostica, si possono scegliere **20, 30, 45, 60, 90, 120, 144, 165 o 240 FPS**. Il valore iniziale è 60 e la scelta viene salvata su quel dispositivo. Nel menu il limite rimane il minore tra 30 e il valore scelto. Un limite superiore alla frequenza dello schermo o alle capacità del dispositivo non forza il raggiungimento di quel valore. Input e simulazione di gioco mantengono la loro frequenza indipendente dal limite grafico.

Per confrontare 30 e 60 FPS usare lo stesso percorso. Il cambio di limite viene registrato e crea segmenti distinti nel report. Una fluidità più regolare a 30 può indicare meno pressione sul rendering; non identifica da sola quale componente sia costoso.

## Confronto A/B

Durante una registrazione i dettagli permettono di disattivare una voce per volta:

| Voce | Cosa cambia nella prova |
| --- | --- |
| Terreno completo | Salta il disegno del terreno; rimane il riempimento di fondo. |
| Maschere | Usa il rendering precedente dei bordi; salta anche le fasce animate che dipendono dai contorni delle maschere. Confrontare il mare separatamente prima di questo caso. |
| Macchie pittoriche | Salta le texture pittoriche di terreno e acqua. |
| Fasce del mare animate | Salta soltanto la sovrapposizione animata delle fasce. |
| Sprite dei personaggi | Salta il disegno dei personaggi, mantenendo simulazione e collisioni. |
| Asset della mappa | Salta il disegno degli asset collocati. La ricerca, l'ordinamento e i calcoli di visibilità restano misurati separatamente. |
| Pioggia e neve | Salta il disegno del meteo, conservando nel report quale meteo sarebbe attivo. |

Esempio: 15 secondi con tutto attivo, 15 senza mare animato, poi riattivarlo e ripetere lo stesso tragitto. Registrare a parte un confronto con il meteo disattivato. Cambiare molte voci contemporaneamente dimostra soltanto il costo combinato, non la responsabilità di una singola voce.

Le prove sono locali e non modificano il World Maker, la mappa salvata, il server o le collisioni. Quando si ferma o chiude la registrazione tutto torna attivo. Maschere, macchie e mare possono richiedere una ricostruzione della cache al cambio: non considerare quel singolo frame come costo continuo della nuova configurazione. L'avvio del registratore da solo non invalida il terreno.

## Contenuto del report

- FPS disegnati, target, intervalli P50/P95/P99, massimo, intervalli oltre 50 e 100 ms e tempo CPU dei frame.
- Frame con fasi e contatori: input, presentazione/simulazione locale, audio, minimappa, preparazione della camera, terreno, maschere, materiali, mare animato, sprite, asset, effetti, meteo e overlay.
- Cache del terreno: riuso, ricostruzione completa o scorrimento, motivo, pixel aggiornati e dimensioni della bitmap. Rasterizzazioni di sprite ambientali, macchie e asset sono cronometrate separatamente quando avvengono.
- Rete: ping, input in attesa, byte nella coda d'invio WebSocket, età dell'ultimo snapshot, jitter di arrivo, ritardo e dimensione del buffer di interpolazione, decodifica e callback degli snapshot.
- Server: un campione dell'endpoint operativo `/health` all'avvio e ogni cinque secondi durante la registrazione, con costo tick, P95/massimo di simulazione e snapshot, tick di recupero e snapshot saltati. Le statistiche sono aggregate sul server, non una misura per singolo giocatore; il tempo della richiesta include il trasporto. Una risposta non disponibile non interrompe la cattura.
- Viewport, DPR, zoom, numero di attori e asset, chunk generati, configurazione pittorica e stime dei pixel delle risorse all'inizio e alla fine.
- Eventi di cambio delle opzioni e del limite FPS, stato della scheda, eventi Canvas, campioni heap JS quando disponibili, Long Tasks e Long Animation Frames se il browser li supporta.
- Segmenti consecutivi distinti per target FPS, modalità menu/partita, meteo e opzioni A/B. Il primo intervallo del segmento è escluso dal suo calcolo FPS per non attribuire al nuovo segmento un ritardo accumulato prima del cambio.
- `jankEvidence`: i 20 campioni peggiori, con frame precedente, lavoro asincrono e Long Entries sovrapposti al ritardo. Sono correlazioni, non una diagnosi automatica della causa.

Le fasi sono annidate: `terrain` comprende ricostruzione, maschere, materiali e mare; `render` comprende l'intero disegno. Non sommare padre e figli. Per le operazioni rare sono disponibili sia i valori sull'intera sequenza sia `whenActive`, che permette di vedere il costo delle ricostruzioni senza diluirlo nei frame che riusano la cache.

## Interpretazione e limiti

Una ricostruzione completa alta insieme a `masks-geometry`, `shore-static`, `ground-wash-raster` o `terrain-scenery` indica dove si è speso tempo CPU durante il caricamento del terreno. `sea-animation` o `sprites` elevati ripetutamente indicano invece lavoro continuo. `snapshot-callback` alto può bloccare il client anche tra due frame; ping e buffer aiutano a distinguere ritardi di rete da stalli locali. Ritardi degli snapshot possono anche essere una conseguenza del thread bloccato, non solo della rete.

La fase del frame N non è necessariamente responsabile del ritardo **prima** di N: controllare anche N−1 e il lavoro asincrono. Se gli intervalli sono alti mentre i tempi JS sono bassi, possono essere coinvolti rasterizzazione differita, compositing/GPU, raccolta della memoria o scheduling del sistema operativo. Il browser non fornisce qui una misura attendibile di utilizzo GPU, temperatura, throttling, VRAM residente, pause GC o carico CPU totale del dispositivo. Questi campi non vengono inventati. `frameCpuBusyPercent` riguarda solo il lavoro JS misurato nei frame, non l'utilizzo totale della CPU.

I tempi delle chiamate Canvas sono invio CPU: il completamento del disegno può avvenire dopo il ritorno della chiamata. I pixel delle risorse consentono una stima RGBA moltiplicando per quattro, ma non includono copie interne del browser, immagini decodificate o ogni risorsa del gioco. Le API non disponibili vengono indicate come tali; l'assenza di Long Tasks su un browser non dimostra l'assenza di blocchi.

## Confronto dal World Maker

In `05 · World Painting → Livelli grafici`, gli interruttori **Mare** e **Maschere** restano opzioni di personalizzazione salvate nella mappa, esportate e installate con **Applica al gioco**. Le mappe precedenti li considerano entrambi ON. Mare OFF conserva il colore base dell'acqua ma elimina macchie, sfumature costiere e movimento; Maschere OFF usa celle quadrate senza le geometrie di transizione. Il mare può animarsi anche con Maschere OFF, seguendo i bordi quadrati. Le impostazioni dettagliate vengono conservate e riutilizzate riattivando le opzioni. Non cambiano generazione, collisioni o velocità.

Per ripetere il confronto in sviluppo, registrare quattro JSON separati: ON/ON, ON/OFF, OFF/ON, OFF/OFF (ordine Mare/Maschere). Dopo ogni applicazione riaprire il gioco sul telefono e attendere la fine del caricamento. Tenere uguali cacciatore, percorso, durata, FPS e altre impostazioni; non modificare gli interruttori A/B del pannello durante il confronto. La configurazione è presente in `metadata.renderer.painting`; ogni frame include anche `paintingSeaEnabled` e `paintingMasksEnabled`. Gli screenshot non sostituiscono i JSON.

## Costo della diagnostica

Il registratore è disattivato normalmente. Non esegue letture dei pixel, logging per frame in console, upload o scritture sincrone del report durante la cattura. Usa buffer circolari limitati a 3.600 frame, 7.200 intervalli RAF, 12.000 campioni di lavoro asincrono, 256 eventi e 128 Long Entries. I campioni più vecchi vengono sovrascritti. Gli eventi duplicati di scatto sono limitati a uno al secondo per conservare i cambi di configurazione; gli intervalli di tutti i frame conservati rimangono disponibili. Su schermi rapidi il buffer può conservare meno di 60 secondi; i limiti sono dichiarati nel file.

Il pannello si aggiorna una volta al secondo. Statistiche, ordinamenti completi e JSON vengono preparati su richiesta; l'esportazione ferma prima la registrazione. La strumentazione aggiunge comunque un piccolo costo quando attiva, quindi confrontare acquisizioni con la stessa diagnostica attiva. Il report non include nomi dei giocatori, credenziali, token, payload di rete o coordinate dei personaggi e resta nella memoria della scheda fino al download. Perdere o ricaricare la pagina perde la registrazione non esportata.

## Verifica

`tests/performance-log.test.ts` controlla cadenza reale, ritardi non limitati, scheda nascosta, buffer circolari, fasi asincrone e arresto automatico. `tests/frame-budget.test.ts` verifica tutti i limiti FPS su frequenze di schermo diverse. `tests/integration/performance-browser.test.ts` avvia un server con account temporaneo, prova PC e controlli touch, verifica che si possa camminare con la cattura compatta attiva, induce intenzionalmente uno stallo, modifica le opzioni A/B, controlla il limite FPS, raccoglie le metriche del server e scarica un JSON verificando l'assenza delle credenziali di prova. Il server viene chiuso in `finally`.

`performance-browser.test.ts` controlla anche che il caricamento normale non monti alcuno strumento diagnostico, mantenga i selettori FPS e lasci il registratore inattivo. La produzione viene verificata separatamente con la query diagnostica presente.
