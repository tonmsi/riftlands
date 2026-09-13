# Rovine e ricompensa essenziale

Le Rovine della Soglia si trovano nel mondo globale a `(0, -3840)`: seguire il sentiero sinuoso verso nord dall'avamposto, circa 20 secondi di cammino senza soste. Pietre runiche lungo il percorso e il simbolo a rombo sulla minimappa indicano la direzione senza cartelli testuali nel mondo. Il cortile ha mura e quattro pilastri con collisioni e blocco dei proiettili. Non genera NPC o pickup procedurali al suo interno.

## Incontro e loot

- Il Custode delle Rovine ha 460 HP e insegue anche chi rompe la linea visiva, calcolando un percorso locale a otto direzioni attorno a pilastri e mura e semplificando i tratti liberi per evitare zig-zag e rallentamenti inutili. Alterna colpo ravvicinato, schianto circolare, carica lineare e nova ad anello; le tre mosse pesanti sono telegrafate e richiedono posizionamenti diversi. Sotto il 45% di vita si muove e attacca più rapidamente.
- Il primo giocatore vivo e connesso di un team che supera la soglia interna avvia una preparazione di **5 secondi**. Il boss resta inattivo e gli accessi rimangono aperti; tutti i membri online del team vedono il conto alla rovescia e quanti compagni sono pronti. Un membro viene prenotato appena attraversa la soglia e conserva il posto finché è vivo, connesso e non abbandona completamente l'area. Allo zero i prenotati vengono collocati in punti interni sicuri e separati, poi il roster viene congelato. Chi è rimasto fuori non può aggiungersi dopo. Un giocatore senza team entra invece immediatamente.
- Le aperture ufficiali nord e sud diventano terreno solido sincronizzato con il client. Un partecipante che oltrepassa il limite esterno viene ucciso come in un normale decesso ed è eliminato dal combattimento: dopo il respawn rimane fuori e non viene ucciso nuovamente. Se non resta alcun partecipante vivo, la stanza si apre e il boss torna immediatamente al massimo della vita. Alla scadenza dei 20 secondi di tolleranza, anche un partecipante disconnesso viene considerato morto; una riconnessione precedente riprende lo stesso combattimento.
- Le aperture laterali restano volutamente imperfette: un nemico non partecipante può penetrare soltanto nella fascia esterna e attaccare in PvP chi sta combattendo. Non può diventare partecipante né danneggiare o ricevere loot dal boss. Questo comportamento è intenzionale per questo incontro.
- L'aggro è condiviso: il boss sceglie tra i partecipanti vivi quello con più minaccia accumulata tramite danni inflitti; a parità prende il più vicino. Gli attacchi ad area possono colpire contemporaneamente più membri. La minaccia da cure non è ancora prevista.
- Le rovine **non sono una safe zone**: il PvP globale resta attivo.
- Alla morte vengono creati drop privati per tutti i partecipanti registrati. I **50 gold** totali sono divisi per il loro numero con `floor(50 / N)`; l'eventuale resto non viene assegnato (per esempio, tre partecipanti ricevono 16 gold ciascuno). Il colpo finale non modifica la divisione.
- I gold non sono accreditati alla morte del boss: ogni partecipante deve passare sul proprio drop, vivo e connesso. Sono raccoglibili da 500 ms dopo la morte, con distanza massima pari al raggio del personaggio più 18 unità. Se il giocatore è già sovrapposto, la raccolta avviene automaticamente dopo questo intervallo.
- Ogni partecipante riceve soltanto il proprio drop negli snapshot. Gli altri vedono il cadavere, senza monete raccoglibili.
- Il cadavere rimane fino al respawn, **60 secondi dopo la morte**, anche se tutti si allontanano. Il timer non dipende dai chunk caricati.
- I drop non raccolti scadono dopo **120 secondi**, senza diventare pubblici. Possono quindi rimanere mentre il boss successivo è già vivo. Disconnessione e morte del proprietario non trasferiscono la proprietà.
- Il saldo è visibile in un contatore con moneta in alto a destra durante il gioco e nella scheda della sessione attiva sulla pagina principale. È persistente per account. Nessuna spesa, gemma, negozio o ricompensa arena è introdotta.

## Organizzazione e salvataggio

`shared/bosses.ts` contiene `BossDefinition`, catalogo, attacchi, fasi, ricompense, respawn e geometria delle chiusure. `server/boss-encounter.ts` è il runtime condiviso per proprietà, pathfinding, combattimento, fallimento, loot e persistenza. `shared/ruins.ts` contiene soltanto geografia e terreno specifici delle rovine. Per aggiungere un boss ordinario si aggiunge una definizione al catalogo; codice dedicato serve solo per una meccanica non rappresentabile dagli attacchi disponibili.

L'archivio JSON versione 2 usa i campi opzionali `gold` degli account e la mappa `bosses` indicizzata per ID. Il precedente campo singolo `ruins` viene migrato automaticamente alla prima lettura senza perdere cadavere, timer o drop. Gli account precedenti partono da zero gold; valori malformati sono rifiutati. Alla raccolta, incremento del portafoglio e rimozione del drop vengono salvati nella stessa sostituzione atomica del file: non sono due scritture separate.

Cadavere, scadenza del respawn e proprietà/scadenza dei drop sopravvivono al riavvio. I timer sono assoluti: il tempo trascorso a server spento conta. La vita del boss ancora vivo e il suo combattimento non vengono salvati: al riavvio riparte integro. Rimane un archivio con un solo processo scrittore, non una soluzione per più server concorrenti.

Il protocollo è **5**: snapshot con più telegraph e stati di chiusura sincronizzano ogni arena boss. Aggiornare client e server insieme. Prima del deploy fare un backup del file account; un rollback a server precedenti non conserva necessariamente la mappa `bosses`.

## Verifica

`npm test` comprende chiusura, ingresso e premio di squadra, aggro, morte per uscita/disconnessione, accesso laterale intenzionale, raccolta una sola volta, scadenza, riavvio, respawn indipendente dai chunk, terreno, pathfinding e attacco schivabile.

Dopo `npm run build`, eseguire `node --import tsx --test tests/integration/ruins-browser.test.ts` per una prova con due browser reali: uccisione, cadavere condiviso, monete private, raccolta fisica e saldo salvato. Usa account e server di produzione temporanei, chiusi a fine test. Su Windows usa Chrome; il canale può essere scelto tramite `PLAYWRIGHT_CHANNEL`. Le schermate vengono salvate in `test-results/ruins-*.png`.
