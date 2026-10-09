# Interni e warp

Il World Maker contiene la sezione **Interni, dungeon e passaggi**. L'open world e gli interni sono superfici separate: l'interno non occupa un'area della mappa globale e viene simulato in una stanza condivisa. Inventario, missioni, vita, risorse e cooldown restano quelli del personaggio.

I controlli sono nella sezione richiudibile **Interni, dungeon e passaggi**, chiusa inizialmente. Il campo **PvP dell'interno** sceglie la regola generale di edifici e dungeon separati: gli interni esistenti e quelli nuovi sono sicuri per impostazione predefinita. Salva le modifiche con **Aggiorna interno**, poi **Applica al gioco**. Le zone con PvP esplicito hanno precedenza, poi l'eventuale regola del dungeon, poi quella della mappa. Disabilitare il PvP non disabilita nemici e boss.

## Creare un edificio

1. Inserisci nome, larghezza e altezza, quindi premi **Crea interno**. Le dimensioni vanno da 4 a 512 caselle per lato; il nuovo interno ha un pavimento calpestabile e limiti invalicabili.
2. Disegna pavimento e pareti con il pennello terreno. Piazza gli asset del catalogo condiviso e gli NPC con gli strumenti esistenti. All'interno non vengono generati cespugli, nemici o pickup casuali. Scegli se abilitare il PvP nel campo dell'interno; puoi aggiungere zone con regole diverse.
3. Seleziona **Open world**, premi **Posiziona warp** e clicca sulla porta dell'edificio.
4. Nell'ispettore scegli nome, destinazione, casella d'arrivo e attivazione: attraversamento automatico oppure interazione con **F** o pulsante su schermo.
5. Il passaggio è bidirezionale per impostazione predefinita. **Apri altro lato** apre la mappa collegata e centra la porta, senza spostarla. **Sposta passaggio** permette di cliccare la nuova casella della porta sulla mappa attualmente visualizzata. Per spostare il lato opposto, aprilo e usa lo stesso comando. Modificando un lato si aggiorna anche il ritorno. Cambiare la destinazione aggiorna subito il collegamento; se non specifichi nuove coordinate, l'arrivo iniziale è lo spawn della nuova mappa. Nome, coordinate e attivazione si modificano nell'ispettore con **Aggiorna passaggio** o prima di usare i comandi di apertura/spostamento.
6. Ripeti per altre porte o uscite segrete. **Solo andata** elimina il ritorno della porta selezionata: prevedi un'altra uscita per l'interno. Aprire l'altro lato non abilita il ritorno; togli la spunta a **Solo andata** per renderlo bidirezionale. Eliminare un passaggio bidirezionale elimina entrambi i lati.
7. Premi **Verifica progetto**, correggi gli eventuali problemi, quindi **Applica al gioco**. Come per gli altri contenuti compilati, riavvia il gioco/server per caricare il progetto applicato.

Le porte sono evidenziate in azzurro nell'editor; gli arrivi dei collegamenti a senso unico sono cerchi dorati con etichetta. Con lo strumento **Seleziona**, clicca su una porta o un arrivo per aprire l'ispettore, oppure scegli il passaggio nell'elenco della mappa. La croce indica lo spawn generale e non determina l'arrivo dei warp: ogni passaggio ha coordinate proprie. Il World Maker salva, esporta e ripristina tutti gli interni insieme al progetto, con annulla/ripeti. **Elimina interno e collegamenti** è annullabile e rimuove anche i warp che lo referenziano.

## Collegamenti validi

Gli interni non richiedono ingressi o uscite verso l'open world: puoi salvare mappe isolate, collegamenti soltanto tra piani e destinazioni a senso unico. Puoi collegare mondo, piano terra, primo piano e cantina senza aggiungere una porta esterna per ogni piano. Ingressi e arrivi devono essere calpestabili, fuori dalle entrate arena. La verifica impedisce ingressi sovrapposti e arrivi oltre i limiti della mappa e controlla i riferimenti alle mappe e la coerenza dei passaggi bidirezionali. Le coordinate indicano caselle; il personaggio arriva al centro della porta scelta. Restando sulla porta dopo un trasferimento non si torna indietro: bisogna uscire dall'area di attivazione e rientrare, anche per i passaggi con interazione.

Durante l'attraversamento lo schermo si scurisce, il server salva la posizione di partenza e trasferisce il personaggio. Lo schermo si schiarisce dopo il primo snapshot della nuova stanza. I controlli si fermano, dialoghi e bersagli vengono chiusi, gli input della stanza precedente vengono ignorati. Non si attraversa durante la pesca o un combattimento attivo. Se un trasferimento fallisce, il personaggio resta nella stanza di partenza.

Disconnessioni e riavvii conservano la posizione interna. Se l'interno viene rimosso, il personaggio recupera l'ultima posizione esterna; se bloccata, usa uno spawn sicuro. Riconnettersi sopra una porta non provoca un nuovo ingresso automatico finché non ci si allontana.

## Dungeon e passaggi segreti

Per usare un dungeon installato in un interno, crea una superficie abbastanza grande e piazza il dungeon con lo strumento **Dungeon**. Quell'assegnazione lo sposta fuori dall'open world; non può essere attivo in due interni diversi. Il catalogo del Dungeon Maker continua a gestire terreno, boss e incontri. Aggiornamenti, rimozioni e spostamenti tengono conto delle assegnazioni interne e dei salvataggi dei boss.

In alternativa, scegli il dungeon nella sezione richiudibile e premi **Crea interno da questo dungeon**: dimensioni e piazzamento vengono preparati automaticamente, con due caselle di margine e uno spawn sicuro esterno alle pareti del dungeon. Scegli i punti dei passaggi come per un edificio. Puoi anche creare una mappa vuota di tipo **Dungeon** e disegnarla manualmente. Selezionando un dungeon piazzato sulla mappa, il campo **PvP del dungeon** permette di abilitarlo, disabilitarlo o ereditare dalla mappa; vale anche per i dungeon rimasti nell'open world.

Un passaggio segreto è un warp configurato allo stesso modo: può usare un'immagine di botola e l'interazione, con un'uscita in un altro punto del mondo. Non vengono sbloccati automaticamente requisiti di quest o porte chiuse: queste condizioni potranno estendere il collegamento.

## Server separati

Il collegamento contiene ID di mappa e coordinate, senza indirizzi di server. Oggi open world, interni e arene girano nello stesso processo, in simulazioni distinte. Un futuro servizio potrà risolvere una destinazione su un altro server mantenendo lo stesso formato dei contenuti. Le istanze private di gruppo e il trasferimento tra processi richiedono un ulteriore intervento; gli interni di questa versione sono condivisi.

## Verifica

`tests/warps.test.ts` verifica porte multiple, isolamento delle mappe, personaggio persistente, salvataggio/riavvio, recupero di mappe rimosse, annulla e validazione. I test browser coprono l'autore del World Maker, la dissolvenza su desktop/mobile e il client reale con WebSocket, snapshot compressi, cambio stanza e riconnessione.
