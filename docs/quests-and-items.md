# Missioni, dialoghi e oggetti

La prima missione è **Esche puzzolenti**. Nereo, vecchio pescatore, è un NPC neutrale con aspetto circolare di fallback disegnato in Canvas. È piazzato nel progetto del mondo alla cella `(3, 1)`, vicino allo spawn; lo si può spostare o piazzare anche nel World Maker e nel Dungeon Maker. Cammina lentamente attorno al punto assegnato, alternando passi e pause, rispettando ostacoli e un raggio di 96 unità.

## Come provarla

1. Avvicinati a Nereo e premi **F**, oppure premi sul personaggio, anche da touch.
2. Parla dell'evento oppure accetta di procurargli **3 interiora di gelatina**.
3. Solo durante la missione attiva, ogni gelatina uccisa dal giocatore ha il **50%** di probabilità di lasciare un'interiora. Passaci vicino per raccoglierla. Questo bottino è riservato al giocatore che ha ucciso la gelatina.
4. La sacca sotto la minimappa parte con **uno slot vuoto**. Le interiora si accumulano nello stesso slot, fino a 9999.
5. Torna da Nereo: durante la sua richiesta, premi sull'oggetto nella sacca. Si possono consegnare quantità parziali; Nereo consuma soltanto ciò che manca, lasciando gli eccessi nell'inventario.
6. Tieni premuto lo slot per circa **650 ms** per scegliere quante interiora gettare. Usa **+ / −**: un tocco cambia di uno, mentre una pressione prolungata cambia di dieci accelerando fino a un passo ogni **200 ms**. Si può arrivare a **zero**, che disabilita Getta; Annulla chiude il selettore senza perdere oggetti. La quantità è un indicatore, senza campo di input né tastiera virtuale. Il mucchio a terra è pubblico: gli altri giocatori possono raccoglierlo passandoci vicino. Scompare dopo **10 secondi**, anche se nessuno lo raccoglie. Chi lo getta ha un secondo di ritardo prima di poterlo raccogliere di nuovo.

Il contorno di Nereo è dorato prima dell'accettazione, turchese tratteggiato durante la missione e attenuato dopo il completamento. Lo stato è personale: due giocatori possono vedere contorni diversi. Dopo la consegna Nereo continua a parlare e offre nuovamente la missione dopo 5 minuti. Un attacco ricevuto o inflitto, l'allontanamento, la morte, l'uscita o il cambio di istanza terminano la conversazione. Il mondo multiplayer continua a vivere durante il dialogo.

Dialogo e selettore della quantità consentono di continuare a muoversi, anche tenendo il joystick con un dito e usando i pulsanti con un altro. Il dialogo si chiude quando la distanza dal personaggio supera 144 unità. Il box è centrato e limitato nelle dimensioni; scorre soltanto il testo, lasciando disponibili le risposte. Il selettore compatto appare accanto allo slot, sopra l'area dei comandi. Le indicazioni di utilizzo e raccolta sono in questa guida, senza etichette esplicative attorno alla sacca.

Alla risposta **Buona pesca** Nereo reagisce con una maledizione verbale per l'augurio che porta sfortuna. Non applica effetti al giocatore: alla conversazione successiva torna amichevole e la missione resta completata.

## Diario e storico

Con missioni attive il riquadro del giocatore ha un sottile bordo blu. Premi su qualsiasi punto del riquadro per aprire il diario: mostra le missioni, gli oggetti nella sacca e le consegne già effettuate. La sezione dei traguardi in corso è predisposta; nessun achievement viene ancora assegnato automaticamente.

Nel menu **Achievement → Missioni completate** compaiono soltanto le missioni concluse. I vecchi salvataggi con una missione completata valgono una conclusione. Le definizioni future possono dichiarare `repeatable: true`: `acceptQuest` conserva il numero delle conclusioni precedenti e azzera gli obiettivi della nuova esecuzione; `advanceQuest` aumenta il contatore solo al completamento. Nereo è ripetibile dopo 5 minuti dal completamento (`repeatAfterMs`): il server salva `completedAt` sul personaggio della classe e, alla scadenza, lo stato esposto da `questStatus` torna disponibile, con il dialogo iniziale e il relativo indicatore. Il tempo offline conta; una missione ancora attiva mantiene le consegne parziali. I vecchi completamenti privi di timestamp sono subito ripetibili. Lo storico resta conservato durante ogni nuova esecuzione.

I pannelli condividono `client/ui/popups.ts`: premere sul mondo o Esc li chiude. L'inventario e il joystick restano utilizzabili durante una conversazione. Il selettore di quantità usa il livello superiore nativo del browser, quindi i gold non possono coprirlo. Le nuove finestre vanno registrate nello stesso gestore, con la propria superficie, pulsante di apertura e funzione di chiusura.

Ogni classe conserva il proprio progresso narrativo. Il progresso narrativo viaggia soltanto nel primo snapshot della connessione e quando cambia la revisione; gli snapshot senza `narrative` conservano il diario precedente. Le transazioni narrative devono passare per `acceptQuest`/`advanceQuest`, che aggiornano la revisione. Il server restituisce lo storico tramite `/api/lobby` esclusivamente all'account autenticato, senza includerlo nelle classifiche o nei dati degli amici.

## Sprite degli NPC neutrali

Nereo passa per lo stesso caricamento, cache dei frame, orientamento e animazione degli altri NPC. Per assegnargli una sprite aggiungi `assets/npc-old-fisher.svg` oppure `assets/npc-old-fisher.png`: il foglio standard contiene **4 colonne × 4 righe**, con celle di **256 × 256**, orientamenti sud, nord, ovest, est. Gli altri template possono usare `assets/npc-<id-template>.svg` o `.png`. Se il foglio manca o non si carica viene usato il fallback circolare. Ricostruisci il frontend dopo aver aggiunto una nuova risorsa.

Riavvia il server e aggiorna il browser dopo questa modifica: il protocollo è passato alla versione 10.

## Struttura

- `shared/items.ts`: catalogo degli oggetti, stack e inventario versionato con capacità esplicita; l'inserimento riempie prima gli stack esistenti e fallisce senza modificare niente se manca spazio.
- `shared/narrative.ts`: definizioni delle missioni e grafo dei dialoghi, condizioni, azioni e progressi personali. I testi e le transizioni sono dati tipizzati.
- `shared/loot.ts`: regole di bottino, probabilità e condizioni narrative, separate dal combattimento.
- `shared/npcs.ts`: catalogo dei personaggi manuali, con disposizione e riferimento al dialogo. I personaggi neutrali non entrano nei pesi della popolazione ostile procedurale.
- `server/interactions.ts`: conversazioni e transazioni autorevoli. Verifica distanza, linea di vista, vita, sessione, oggetto e quantità. Ogni avanzamento cambia il token della conversazione: un comando ripetuto non duplica una consegna.
- `client/ui/interactions/interaction-ui.ts`: presentazione dei dialoghi e dello slot; gli aggiornamenti della simulazione mantengono lo stesso bottone anche mentre viene tenuto premuto.
- `client/ui/interactions/quantity-stepper.ts`: selettore limitato alla quantità disponibile, ripetizione accelerata e cancellazione della pressione su rilascio, chiusura, perdita di focus o cambio di visibilità.
- `client/ui/interactions/item-art.ts`: disegno procedurale riusabile per l'icona nell'inventario e il mucchio a terra.

L'inventario e i progressi narrativi si salvano sull'account esistente. Gli account precedenti ricevono uno slot vuoto e nessuna missione, conservando personaggio, esperienza e altre informazioni. I mucchi a terra sono temporanei e non sopravvivono al riavvio del server. Raccolta e consumo sono indivisibili nella simulazione; il salvataggio usa il sistema di checkpoint degli account, con flush dopo i comandi di interazione. Le istanze PvP usano copie indipendenti dei dati e non permettono queste interazioni.

La raccolta usa l'indice spaziale dei giocatori; i mucchi sono limitati a 2048 e scadono dopo dieci secondi. Nessun oggetto viene tolto dall'inventario se il limite impedisce di gettarlo. Le sessioni durano al massimo due minuti e i comandi hanno un limite di frequenza sul trasporto.

Questa versione implementa un obiettivo di consegna e l'azione di accettazione. Lo stesso protocollo `use-item` può essere esteso per interazioni con oggetti o portali aggiungendo nuovi tipi di richiesta e validazione server. Un editor visuale delle conversazioni potrà produrre queste definizioni; non è ancora incluso. Ulteriori obiettivi, condizioni, ricompense e comportamenti richiedono di estendere i tipi e i relativi gestori, senza introdurre script arbitrari nei contenuti.

## Verifica

`tests/interactions.test.ts` copre l'intera missione nella simulazione, soglia del drop, progressi personali, replay, inventario pieno, raccolta pubblica, scadenza, persistenza, passeggiata, risposta all'augurio, uscita dal range e isolamento delle stanze. `tests/integration/quest-browser.test.ts` verifica il client reale con tre giocatori, movimento durante il dialogo, consegna dal bottone, pressione prolungata touch e raccolta da un altro giocatore. `tests/integration/interaction-layout.test.ts` verifica desktop, mobile verticale e due misure orizzontali, scorrimento del testo, sprite neutrale, selettore senza input, quantità zero e controlli simultanei con due dita. I server di prova usano account temporanei e vengono chiusi nel blocco di pulizia del test.
