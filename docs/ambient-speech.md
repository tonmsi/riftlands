# Fumetti ambientali

Gli NPC definiti in `shared/ambient-speech.ts` parlano quando il personaggio entra entro 180 unità, con linea di vista libera. Brugo, abitante del porto, è posizionato alla cella `(-2, 24)` vicino allo spawn e non offre missioni. Nereo e Ada hanno brevi battute ambientali; i dialoghi interattivi restano nel pannello esistente.

Ogni client gestisce i fumetti del proprio personaggio: due giocatori possono leggere la stessa introduzione in momenti diversi, oppure varianti diverse se hanno già incontrato l’NPC. Il passaggio di un altro giocatore non avvia né interrompe il fumetto locale. Queste battute non richiedono eventi o modifiche agli snapshot del server.

- Un solo fumetto alla volta, leggibile per 4,5–7,5 secondi, seguito da almeno 5 secondi di silenzio. Una priorità maggiore non interrompe il testo già in lettura.
- Fra gli NPC appena entrati nel raggio e disponibili, precedenza a chi è coinvolto in una quest attiva (`questMarker: active`), poi a chi ha un’introduzione ancora mai vista, poi al più vicino. A parità di distanza decide l’ID, indipendentemente dall’ordine degli snapshot.
- Tutti gli ingressi vengono registrati subito, anche quelli degli NPC che perdono la selezione o entrano durante un altro fumetto o la pausa globale. Nessuna coda: alla fine del fumetto i vicini restano silenziosi finché il giocatore non esce e rientra nel loro raggio. Le introduzioni scartate non vengono segnate come lette.
- Pausa di 45 secondi per NPC. Occorre uscire oltre 240 unità e rientrare: attendere sul posto non provoca altre battute.
- Introduzione garantita quando l’NPC ottiene la precedenza, una volta per personaggio. Per le varianti successive, 50% di probabilità di parlare al nuovo ingresso valido, poi rotazione senza ripetizione consecutiva.
- La probabilità si valuta una sola volta sull’NPC selezionato. Se resta in silenzio, nessun vicino prende il suo posto e non si ritenta finché il giocatore non esce e rientra. Un tentativo silenzioso non consuma cooldown o varianti.
- Introduzione, ultima battuta e indice della variante sono conservati in localStorage per account, classe e NPC. La memoria conserva al massimo 64 NPC. Cambiare browser o cancellarne i dati azzera questo storico; non è un dato salvato dal server. Se lo storage è indisponibile, rimane la memoria della sessione.
- Nessun fumetto in lobby, arena, durante osservazione, morte, disconnessione, dialoghi, pesca o pannelli che bloccano l’input. Un ostacolo o l’allontanamento chiudono quello attivo.

Il rendering usa pixel dello schermo per mantenere il testo leggibile a ogni zoom, va a capo e mantiene il riquadro nei bordi del canvas. Le future reaction dei player potranno usare lo stesso disegno (`client/render/speech-bubble.ts`), ma avranno bisogno di eventi condivisi dal server per essere viste dagli altri; non sono ancora implementate.

Verifica: `tests/ambient-speech.test.ts` copre indipendenza dei viewer, attese, oscillazioni al confine, persistenza, soppressione, storage indisponibile e posizione nel mondo. `tests/integration/ambient-speech-browser.test.ts` verifica il renderer desktop e touch e chiude browser e server temporaneo nel blocco di pulizia.
