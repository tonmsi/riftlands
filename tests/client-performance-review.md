# Review del client Canvas — 18 settembre 2026

Correzioni applicate, mantenendo la simulazione e le entità di gioco complete:

| Problema trovato | Correzione |
| --- | --- |
| `Renderer.classMotion` conservava gli ID dei personaggi scomparsi fino al cambio mondo | Eliminazione delle voci non più renderizzate a ogni frame |
| Ogni attore cercava i colpi in tutti gli eventi, costo attori × eventi | Indicizzazione unica dei bersagli colpiti per frame |
| Ordinamento di tutte le entità, incluse quelle fuori schermo | Filtro della visibilità prima dell'ordinamento; indicazioni dei compagni lontani conservate |
| Interpolazione: Map/Set e array temporanei ricostruiti a ogni frame | Indici per snapshot, associati con WeakMap; filtro prima della copia; rilascio della storia già superata |
| Eventi eliminati solo dal ciclo grafico, che può essere sospeso in background | Scadenza anche alla ricezione dei pacchetti e massimo di 1.024 eventi cosmetici conservati |
| Audio: copia completa di ogni attore a ogni frame, anche lontano o con audio disattivato | Stato minimo aggiornato sul posto; filtro entro 700 unità; niente elaborazione quando silenziato/non disponibile |
| Nomi e ombre ripetuti in scene molto affollate | Oltre 200 entità visibili, dettagli per sé, alleati, bersaglio e boss; sprite, salute e indicatori di stato restano |
| Lavoro grafico inutile nelle schede nascoste | Uscita anticipata dal frame; snapshot e connessione restano aggiornati |

Il problema di memoria trovato è la conservazione di riferimenti nella cache, non la prova di un garbage collector guasto. Togliere quei riferimenti rende gli oggetti recuperabili; diminuire le allocazioni riduce la pressione sul collector. Non viene forzata una raccolta manuale.

Protezioni già presenti e mantenute: cache terreno di 160 chunk, buffer massimo di 32 snapshot anche quando la scheda non renderizza, DPR massimo 2, viewport logico limitato, massimo 24 voci audio con disconnessione dei nodi a fine suono, limite agli input in attesa e backpressure WebSocket su client/server.

## Verifiche

- Build produzione e TypeScript superati.
- 128 test unitari superati; aggiunta una prova con 80 ricambi di 2.000 attori, controllo della visibilità corrente e rilascio della storia obsoleta.
- Test browser Chrome headless: HUD desktop 1440×960 e touch 390×844, menu, audio, uscita, Escape, coordinate assenti e nessun errore JavaScript.
- Renderer sintetico, 2.000 entità miste giocatori/mostri con ID nuovi a ogni frame e 1.000 eventi fuori schermo: con 300 entità visibili, mediana 1,7 ms e p95 4,7 ms; con tutte 2.000 visibili, mediana 5,8 ms e p95 59 ms nell'ultima esecuzione. Sono tempi CPU della chiamata render, non FPS complessivi né tempi GPU.
- Cache animazioni: massimo 2.001 voci e ritorno a 1 (il giocatore) dopo la scomparsa della folla.
- Il test avvia un server isolato con account temporaneo e attende la sua chiusura nel blocco finally.

## Limiti della verifica

Il caso estremo conserva picchi: questa prova sincrona forza un ricambio completo delle entità a ogni iterazione e non garantisce 60 FPS, soprattutto su telefoni reali. Non è un test di 2.000 connessioni simultanee. Parsing JSON, trasferimento degli snapshot, compositing GPU e simulazione server richiedono misure end-to-end con traffico e dispositivi reali per definire una capacità supportata. Il filtro server per distanza è già presente, ma non limita il numero di giocatori concentrati nello stesso punto. Non sono stati nascosti avversari né ridotti gli aggiornamenti autorevoli per far apparire migliori i risultati.

Comando riproducibile: `node --import tsx --test tests/integration/client-load.test.ts`.
