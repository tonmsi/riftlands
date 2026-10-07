# Pietre che camminano

Rovan, esploratore diffidente, si trova alla cella `(0, 16)`, a nord di Nereo. Offre **Pietre che camminano** anche senza aver aiutato Nereo. Se lo hai aiutato, il dialogo ricorda quel favore, ma le missioni narrative non impongono un ordine.

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

Verifiche: `tests/exploration-quest.test.ts` controlla dialoghi indipendenti da Nereo, arrivo, limiti dell’area, premi unici, morte/disconnessione, zone spostate/sovrapposte e posizioni/statistiche degli NPC. `tests/integration/exploration-quest-browser.test.ts` verifica diario, indicatore e feedback di Rovan/Nereo su desktop e touch; browser e server temporaneo vengono chiusi nel blocco di pulizia.

## Il soldato ferito e Platos

Daro, soldato ferito, è alla cella `(-2, -4)`. Offre **Ascolta il vecchio** (`find-platos`): racconta di non aver ascoltato Platos e consiglia di portare provviste per il lungo viaggio. Le provviste sono un consiglio narrativo, non un requisito di inventario. La missione si conclude entrando nel rifugio e assegna una sola volta **150 XP**, usando lo stesso sistema di esplorazione.

Platos è alla cella `(30, -50)`. La zona circolare `zone-platos` ha centro `(30.5, -49.5)` e raggio 4 celle; posizione dell’NPC e zona sono modificabili nel World Maker. È un piazzamento iniziale sulla geografia esistente: non aggiunge una nuova strada o decorazioni.

Puoi parlare direttamente con Platos senza accettare incarichi. Il server memorizza `met-platos` nei progressi del personaggio dopo una conversazione valida: Daro mostra quindi soltanto il dialogo sulla ferita e non offre più la missione. Saltare l’incarico non lo accetta né ne assegna il premio automaticamente. Il ricordo è personale, persiste e non influenza gli altri giocatori.

Tutti gli NPC neutrali tranne i vendor passeggiano con pause entro il proprio raggio; Daro si sposta più lentamente. Le impostazioni sono in `shared/npcs.ts`. Un clic su un NPC visibile lo seleziona anche da lontano. Se è vivo, entro 144 unità e in linea di vista, lo stesso clic apre anche il dialogo; **F** seleziona e fa parlare l’NPC interagibile più vicino. Il target resta visibile insieme alla conversazione.

`tests/story-npcs.test.ts` verifica ordine libero, arrivo, premi, ricordi personali, conversazioni fuori raggio, snapshot immutabili e movimento. `tests/integration/interaction-layout.test.ts` verifica anche la presenza contemporanea del target e del dialogo su desktop e touch.
