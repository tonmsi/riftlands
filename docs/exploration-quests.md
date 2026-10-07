# Pietre che camminano

Rovan, esploratore diffidente, si trova alla cella `(0, 16)`, a nord di Nereo. Offre **Pietre che camminano** dopo almeno una conclusione di **Esche puzzolenti** per quel personaggio: la missione ripetuta di Nereo e il suo cooldown non bloccano questo requisito storico.

Accetta l’incarico e segui l’indicatore dorato sulla minimappa verso nord. Basta entrare nella zona **Strada delle pietre vive** per completarlo e ricevere **100 XP**, una volta. Nessuna osservazione da cliccare, consegna, uccisione o ritorno obbligatorio. Parlare di nuovo con Rovan resta facoltativo e dà un dialogo diverso dopo la scoperta.

Il server verifica la posizione del personaggio vivo e connesso, con missione attiva. Visitare l’area prima dell’accettazione non dà progressi. Restarci o attraversare più zone collegate alla stessa missione non duplica conclusione o ricompensa. Il progresso usa la persistenza narrativa già esistente per ciascuna classe.

## Strada e pericolo

I cadaveri lungo la strada verranno aggiunti dall’autore tramite immagini nel World Maker. Nessun disegno o piazzamento di cadaveri è incluso in questa modifica; il completamento dipende dalla zona, non dagli asset decorativi.

Tre sentinel esistenti, con sprite e comportamento già disponibili, sono alle celle `(-2, 6)`, `(2, 5)` e `(0, 3)`, a **livello 8**: **151 HP**, **16 danni base** prima dell’armatura. Non cambia il livello degli altri sentinel del mondo. Il punto di arrivo è a sud del gruppo principale: il giocatore può scegliere di ritirarsi o provare a combattere. La difficoltà precisa del percorso resta da bilanciare con una partita reale.

## World Maker e mappa

Seleziona una zona e usa **Obiettivo missione → Pietre che camminano**. Spostare o ridimensionare quella zona sposta anche il trigger server e l’indicatore. Scegli **Nessuno** per rimuovere il collegamento. Puoi collegare più zone alla stessa quest: basta raggiungerne una.

La zona iniziale è `zone-north-road`, rettangolo alle celle `(-4, 4)`, largo 8 e alto 7. `WorldZone.questId` è salvato e validato dal parser; il World Maker segnala collegamenti a missioni inesistenti o non di esplorazione. Non è un editor di dialoghi o ricompense: quelle restano in `shared/narrative.ts`.

La minimappa mostra un’area dorata e un indicatore quando la destinazione è visibile; fuori mappa compare una freccia sul bordo rivolta verso l’area. L’indicatore appare solo per la missione attiva, resta durante snapshot senza aggiornamenti narrativi e sparisce al completamento. Non viene mostrato in arena.

## Conferma delle missioni

Ogni nuova conclusione confermata nei progressi fa brillare per 4,5 secondi il contorno del box del personaggio e mostra **Missione completata · nome missione**, anche per Nereo e le sue ripetizioni. Vale per tutte le classi. I salvataggi caricati e gli aggiornamenti duplicati non producono nuovi avvisi. Uscita e riconnessione azzerano il feedback; chi preferisce movimento ridotto vede il contorno luminoso senza pulsazione.

Verifiche: `tests/exploration-quest.test.ts` controlla requisito storico, arrivo, limiti dell’area, premi unici, morte/disconnessione, zone spostate/sovrapposte e posizioni/statistiche degli NPC. `tests/integration/exploration-quest-browser.test.ts` verifica diario, indicatore e feedback di Rovan/Nereo su desktop e touch; browser e server temporaneo vengono chiusi nel blocco di pulizia.
