# Rovine e ricompensa essenziale

Le Rovine della Soglia si trovano nel mondo globale a `(0, -3840)`: seguire il sentiero sinuoso verso nord dall'avamposto, circa 20 secondi di cammino senza soste. Pietre runiche lungo il percorso e il simbolo a rombo sulla minimappa indicano la direzione senza cartelli testuali nel mondo. Il cortile ha mura e quattro pilastri con collisioni e blocco dei proiettili. Non genera NPC o pickup procedurali al suo interno.

## Incontro e loot

- Il Custode delle Rovine ha 460 HP e insegue anche chi rompe la linea visiva, calcolando un percorso locale attorno a pilastri e mura. Alterna colpo ravvicinato, schianto circolare, carica lineare e nova ad anello; le tre mosse pesanti sono telegrafate e richiedono posizionamenti diversi. Sotto il 45% di vita si muove e attacca più rapidamente. Se tutti abbandonano la zona, torna al centro e recupera la vita.
- Il primo giocatore vivo e connesso che supera la soglia interna diventa proprietario esclusivo dell'incontro. Le aperture nord e sud vengono riempite da terreno solido sincronizzato con il client: il proprietario non può uscire e gli altri non possono entrare, attraversare con uno scatto, colpire il boss o sparare attraverso l'accesso.
- Alla vittoria le aperture tornano transitabili. Se il proprietario muore, oppure scompare dopo i 20 secondi di tolleranza della disconnessione, l'incontro fallisce: la stanza si apre e il boss torna immediatamente al massimo della vita. Una riconnessione entro la tolleranza riprende lo stesso combattimento e lo stesso corpo.
- Le rovine **non sono una safe zone**: il PvP globale resta attivo.
- Il giocatore che infligge il colpo finale riceve la proprietà esclusiva di un drop da **50 gold**. Non c'è condivisione automatica con il team: anche chi contribuisce senza infliggere il colpo finale non riceve gold.
- I gold non sono accreditati alla morte del boss: il proprietario deve passarci sopra, vivo e connesso. Sono raccoglibili da 500 ms dopo la morte, con distanza massima pari al raggio del personaggio più 18 unità. Se è già sovrapposto, la raccolta avviene automaticamente dopo questo intervallo.
- Solo il proprietario riceve il drop negli snapshot. Gli altri vedono il cadavere, senza monete raccoglibili.
- Il cadavere rimane fino al respawn, **60 secondi dopo la morte**, anche se tutti si allontanano. Il timer non dipende dai chunk caricati.
- I drop non raccolti scadono dopo **120 secondi**, senza diventare pubblici. Possono quindi rimanere mentre il boss successivo è già vivo. Disconnessione e morte del proprietario non trasferiscono la proprietà.
- Il saldo è visibile in un contatore con moneta in alto a destra durante il gioco e nella scheda della sessione attiva sulla pagina principale. È persistente per account. Nessuna spesa, gemma, negozio o ricompensa arena è introdotta.

## Organizzazione e salvataggio

`shared/bosses.ts` contiene `BossDefinition`, catalogo, attacchi, fasi, ricompense, respawn e geometria delle chiusure. `server/boss-encounter.ts` è il runtime condiviso per proprietà, pathfinding, combattimento, fallimento, loot e persistenza. `shared/ruins.ts` contiene soltanto geografia e terreno specifici delle rovine. Per aggiungere un boss ordinario si aggiunge una definizione al catalogo; codice dedicato serve solo per una meccanica non rappresentabile dagli attacchi disponibili.

L'archivio JSON versione 2 usa i campi opzionali `gold` degli account e la mappa `bosses` indicizzata per ID. Il precedente campo singolo `ruins` viene migrato automaticamente alla prima lettura senza perdere cadavere, timer o drop. Gli account precedenti partono da zero gold; valori malformati sono rifiutati. Alla raccolta, incremento del portafoglio e rimozione del drop vengono salvati nella stessa sostituzione atomica del file: non sono due scritture separate.

Cadavere, scadenza del respawn e proprietà/scadenza dei drop sopravvivono al riavvio. I timer sono assoluti: il tempo trascorso a server spento conta. La vita del boss ancora vivo e il suo combattimento non vengono salvati: al riavvio riparte integro. Rimane un archivio con un solo processo scrittore, non una soluzione per più server concorrenti.

Il protocollo è **5**: snapshot con più telegraph e stati di chiusura sincronizzano ogni arena boss. Aggiornare client e server insieme. Prima del deploy fare un backup del file account; un rollback a server precedenti non conserva necessariamente la mappa `bosses`.

## Verifica

`npm test` comprende proprietà esclusiva, raccolta una sola volta, morte/disconnessione, scadenza, riavvio, respawn indipendente dai chunk, terreno e attacco schivabile.

Dopo `npm run build`, eseguire `node --import tsx --test tests/integration/ruins-browser.test.ts` per una prova con due browser reali: uccisione, cadavere condiviso, monete private, raccolta fisica e saldo salvato. Usa account e server di produzione temporanei, chiusi a fine test. Su Windows usa Chrome; il canale può essere scelto tramite `PLAYWRIGHT_CHANNEL`. Le schermate vengono salvate in `test-results/ruins-*.png`.
