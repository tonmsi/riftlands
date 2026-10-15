# Interni e warp

Il World Maker divide la barra sinistra in **Mappe**, **Costruisci**, **Popola** e **Dungeon e interni**. L'open world e gli interni sono superfici separate: l'interno non occupa un'area della mappa globale e viene simulato in una stanza condivisa. Inventario, missioni, vita, risorse e cooldown restano quelli del personaggio.

Nella sezione **Dungeon e interni**, scegli il tipo e poi l’area nella lista filtrata. Gli interni hanno **Crea / modifica interno**; i dungeon hanno **Dungeon Maker e boss**. I passaggi si gestiscono nella stessa sezione. Il campo **PvP dell'interno** sceglie la regola generale di edifici e dungeon separati: gli interni esistenti e quelli nuovi sono sicuri per impostazione predefinita. Salva le modifiche con **Aggiorna interno**, poi **Applica al gioco**. Le zone con PvP esplicito hanno precedenza, poi l'eventuale regola del dungeon, poi quella della mappa. Disabilitare il PvP non disabilita nemici e boss.

## Creare un edificio

1. Inserisci nome, larghezza e altezza, quindi premi **Crea interno**. Le dimensioni vanno da 4 a 512 caselle per lato; il nuovo interno ha un pavimento calpestabile e limiti invalicabili.
2. Disegna pavimento e pareti con il pennello terreno. Piazza gli asset del catalogo condiviso e gli NPC con gli strumenti esistenti. All'interno non vengono generati cespugli, nemici o pickup casuali. Scegli se abilitare il PvP nel campo dell'interno; puoi aggiungere zone con regole diverse.
3. Seleziona **Mondo**. Nella sezione dell’interno selezionato, scegli la mappa interna come destinazione, premi **Collega A ↔ B** e clicca sulla porta dell'edificio.
4. La vista apre l'interno: clicca il punto di arrivo. Si creano entrambe le porte e la vista torna alla partenza. Nell'ispettore puoi cambiare nome e attivazione: attraversamento automatico oppure interazione con **F** o pulsante su schermo.
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


## Organizzazione del World Maker

La barra sinistra contiene **Mappe**, **Costruisci**, **Popola** e **Dungeon e interni**. Nell’ultima sezione scegli **Tipo di area → Dungeon / Interni**, poi l’area nella lista filtrata. Gli interni hanno **Crea / modifica interno**; i dungeon hanno **Dungeon Maker e boss**, il catalogo e le proprietà della mappa. Sotto trovi i passaggi dell’area scelta, con una sola voce per coppia bilaterale.

Premi **Collega A ↔ B** e clicca A sulla mappa aperta. La vista apre la mappa scelta per B; mentre aspetta B puoi cambiare destinazione con **Mappa per il punto B**, **Mappa da modificare** oppure selezionando un’altra area. Clicca B per creare entrambi i versi insieme. Puoi collegare mondo e interno, due interni, due dungeon o due punti diversi della stessa mappa. **Annulla posizionamento** interrompe senza creare porte.

Viola indica A, azzurro B; sulla stessa mappa il collegamento selezionato è mostrato anche da una linea. **Apri altro lato** centra B (o A al ritorno); **Sposta passaggio** modifica il lato selezionato mantenendo sincronizzato il ritorno. I nomi includono quello dell’area; rinominandola si aggiornano anche i suoi collegamenti.


La barra sopra la mappa offre **Seleziona** e **Cancella**. Con Seleziona trascina direttamente un ingresso per spostarlo sulla griglia: la porta e l’arrivo del ritorno si aggiornano insieme. Il trascinamento è una sola modifica annullabile; nei limiti di un interno l’ingresso resta dentro la mappa. Con Cancella clicca un ingresso per eliminare entrambi i versi del collegamento, ripristinabili con Annulla.


Il punto di spawn (croce dorata) si sposta trascinandolo con **Seleziona**, nel mondo e negli interni. Lo spostamento è annullabile.

Premi direttamente **A ↔ B** per creare entrambi i versi, oppure **A → B** per creare solo la porta A e l’arrivo B. Il pulsante avvia subito il posizionamento di A. B non permette di tornare ad A. Puoi spostare entrambi i punti e convertire un collegamento esistente dall’ispettore tramite **Solo andata**.

**Dimensione A** e **Dimensione B** permettono ingressi da 1 × 1, 2 × 1, 1 × 2, 3 × 1 e 1 × 3 caselle. La coordinata indica la casella in alto a sinistra; l'arrivo rimane al centro di quella casella. Il ritorno scambia le dimensioni dei due lati. Ogni casella deve essere libera e appartenere alla stessa stanza. I passaggi sono liberi: non richiedono chiavi. Importare un vecchio progetto elimina i requisiti di chiave dai passaggi.

## Dungeon Maker: strumenti e passaggi

La palette del Dungeon Maker raggruppa Mappe, Costruisci, Popola, Passaggi e Boss. Seleziona e Cancella restano sopra la mappa; entità, spawn di incontro e asset si trascinano con Seleziona. Gli errori del dungeon appaiono sopra la mappa e nei dettagli cliccabili.

In Passaggi, Modifica passaggi sulla mappa apre nel maker la vista condivisa del progetto mondo. Per un dungeon installato seleziona il suo interno esistente, oppure crea la mappa dungeon nella bozza mondo disabilitando la vecchia collocazione esterna. A ↔ B, A → B, trascinamento degli estremi e verifica usano gli stessi dati e strumenti del World Maker. I passaggi sono salvati nella bozza mondo e diventano attivi con Applica al gioco; Salva dungeon continua a esportare terreno e incontri. Per una bozza nuova installare prima il dungeon nel catalogo.

## Proprietà di NPC e mob

World Maker e Dungeon Maker condividono i controlli di modello e nome, con Avanzate per dialogo, velocità, movimento, aggro, distanza massima dall’origine, respawn e direzione iniziale. I campi numerici vuoti ereditano il modello; zero è un valore esplicito. Le impostazioni appartengono al singolo piazzamento, si conservano nell’esportazione e sono applicate dal server. Nei dungeon i mob sconfitti durante uno scontro mantengono la regola di permanenza del cadavere fino al reset dell’incontro.

Nel Dungeon Maker la selezione di asset indica dimensioni, livello di disegno e celle bloccanti e offre un collegamento al catalogo del World Maker. Dimensioni, collisioni e visibilità sono proprietà condivise da tutte le istanze dello stesso asset. Ruolo e missioni degli NPC dipendono dai dialoghi esistenti.

## Stanze interne al dungeon

Le stanze sono maschere di caselle, indipendenti da terreno e regioni degli incontri. In Stanze si creano, rinominano, disegnano e ritagliano forme libere, anche a L. Il pennello interpola i trascinamenti e offre dimensioni 1, 3 e 5 caselle; non ruba caselle ad altre stanze. La forma deve essere connessa e non può sovrapporsi. Annulla, Ripeti, salvataggio locale ed esportazione conservano le forme. Il maker mostra tutte le stanze insieme, con contorni e nomi.

Installare o aggiornare la bozza trasferisce le stanze nel dungeon runtime. Collega passaggio apre la vista condivisa del progetto sulla stanza scelta; la tendina Passaggi interni al dungeon centra un’altra stanza mentre si posizionano A e B. I collegamenti fra stanze riutilizzano i normali warp sulla stessa mappa, inclusi A ↔ B, A → B, trascinamento e dimensioni a più caselle. La lista distingue passaggi fra stanze e collegamenti con altre mappe. Nella mappa del Dungeon Maker sono visibili gli estremi e le linee dei passaggi salvati nella bozza mondo. Applicare il progetto mondo e ricompilare/riavviare il gioco rende attivi i collegamenti.

Dentro una stanza il giocatore vede solo quella; nello spazio comune non vede contenuti delle stanze. Il server filtra anche compagni, nemici, boss, oggetti, proiettili, eventi appartenenti ad altre stanze. I bordi virtuali bloccano movimento, scivolamento, dash, proiettili e linea di vista; i warp possono superarli. I boss non si attivano attraverso il confine, e gli spawn di incontro rimangono nella stanza del partecipante. Boss in stanze diverse richiedono incontri separati. Le mappe senza stanze mantengono il comportamento precedente.
