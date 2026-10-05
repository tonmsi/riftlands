# Missioni, dialoghi e oggetti

La prima missione è **Esche puzzolenti**. Nereo, vecchio pescatore, è un NPC neutrale con aspetto circolare di fallback disegnato in Canvas. È piazzato nel progetto del mondo alla cella `(3, 1)`, vicino allo spawn; lo si può spostare o piazzare anche nel World Maker e nel Dungeon Maker. Cammina lentamente attorno al punto assegnato, alternando passi e pause, rispettando ostacoli e un raggio di 96 unità.

## Come provarla

1. Avvicinati a Nereo e premi **F**, oppure premi sul personaggio, anche da touch.
2. Parla dell'evento oppure accetta di procurargli **3 interiora di gelatina**.
3. Solo durante la missione attiva, ogni gelatina uccisa dal giocatore ha il **50%** di probabilità di lasciare un'interiora. Passaci vicino per raccoglierla. Questo bottino è riservato al giocatore che ha ucciso la gelatina.
4. Premi lo zaino sotto la minimappa per aprire gli slot in una fila orizzontale. La sacca parte con **uno slot vuoto**. Le interiora si accumulano nello stesso slot, fino a 9999. Premere fuori, usare un oggetto o Esc richiude lo zaino.
5. Torna da Nereo: durante la sua richiesta, apri lo zaino e premi sull'oggetto. Si possono consegnare quantità parziali; Nereo consuma soltanto ciò che manca, lasciando gli eccessi nell'inventario. Al completamento lascia a terra una pozione curativa e, soltanto la prima volta per quel personaggio, uno zaino da 2 slot. Le ricompense sono personali e restano per **2 minuti**. I gold e l'EXP sono assegnati direttamente con le regole della progressione.
6. Tieni premuto lo slot per circa **650 ms**: il box mostra **nome e descrizione dell'oggetto**, oltre alla quantità da gettare. Usa **+ / −**: un tocco cambia di uno, mentre una pressione prolungata cambia di dieci accelerando fino a un passo ogni **200 ms**. Si può arrivare a **zero**, che disabilita Getta; Annulla chiude il selettore senza perdere oggetti. La quantità è un indicatore, senza campo di input né tastiera virtuale. Il mucchio a terra è pubblico: gli altri giocatori possono raccoglierlo passandoci vicino. Scompare dopo **10 secondi**, anche se nessuno lo raccoglie. Chi lo getta ha un secondo di ritardo prima di poterlo raccogliere di nuovo.

## Zaini, bottino e cura

Lo zaino equipaggiato è separato dai suoi contenuti: occupa il pulsante di apertura, non uno slot. Raccogliendo uno zaino più grande si equipaggia automaticamente, conservando tutti gli oggetti; quello precedente viene inserito negli slot appena aggiunti. La sacca iniziale non è un oggetto recuperabile. Gli zaini uguali o più piccoli occupano uno slot normale e non modificano la capienza. Se non c'è spazio rimangono a terra. La capienza massima è **5 slot totali**, senza inventari annidati. Zaino e contenuti sono salvati separatamente per ogni classe dello stesso account.

Gelatine, fuochi fatui e guardiani effettuano tiri indipendenti per ciascuna regola in `shared/loot.ts`:

| Drop | Quantità | Probabilità |
| --- | --- | --- |
| Gold | 3 | 65% |
| Pozione curativa | 1 | 18% |
| Zaino da 2 slot | 1 | 8% |
| Zaino da 3 slot | 1 | 3,5% |
| Zaino da 4 slot | 1 | 1,5% |
| Zaino da 5 slot | 1 | 0,5% |

Le interiora mantengono la probabilità del 50% soltanto con la missione attiva. Tutti i drop dei mob sono privati per l'uccisore, restano per **2 minuti** e si raccolgono al contatto. I gold vanno direttamente nel saldo condiviso dell'account, anche con inventario pieno. Lo zaino più grande si può raccogliere anche quando tutti gli slot sono occupati. Più regole possono produrre bottino nella stessa uccisione.

Premendo sulla pozione si recuperano **40 HP**, fino al massimo del personaggio, e si consuma un'unità. Lo stack massimo è **20** e il tempo fra due usi è **4 secondi**. Vita piena, personaggio morto, connessione assente, oggetto cambiato o tempo non scaduto non consumano niente. Il server applica la cura e produce il normale effetto visivo del gioco.

Per configurare: modifica probabilità e quantità in `shared/loot.ts`, oggetti/capienza/cura in `shared/items.ts`, ricompense delle missioni in `shared/narrative.ts` (`reward.items`, con `firstOnly` per la prima conclusione), durata dei mucchi in `shared/interactions.ts`. Il limite di mucchi viene verificato prima di consumare una consegna, per non perdere ricompense.

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

Riavvia il server e aggiorna il browser dopo questa modifica: il protocollo è passato alla versione 11.

## Struttura

- `shared/items.ts`: catalogo degli oggetti, stack e inventario versionato con capacità esplicita; l'inserimento riempie prima gli stack esistenti e fallisce senza modificare niente se manca spazio.
- `shared/narrative.ts`: definizioni delle missioni e grafo dei dialoghi, condizioni, azioni e progressi personali. I testi e le transizioni sono dati tipizzati.
- `shared/loot.ts`: regole di bottino, probabilità e condizioni narrative, separate dal combattimento.
- `shared/npcs.ts`: catalogo dei personaggi manuali, con disposizione e riferimento al dialogo. I personaggi neutrali non entrano nei pesi della popolazione ostile procedurale.
- `server/interactions.ts`: conversazioni e transazioni autorevoli. Verifica distanza, linea di vista, vita, sessione, oggetto e quantità. Ogni avanzamento cambia il token della conversazione: un comando ripetuto non duplica una consegna.
- `client/ui/interactions/interaction-ui.ts`: dialoghi, apertura dello zaino e slot orizzontali; gli aggiornamenti della simulazione mantengono lo stesso bottone anche mentre viene tenuto premuto.
- `client/ui/interactions/quantity-stepper.ts`: selettore limitato alla quantità disponibile, ripetizione accelerata e cancellazione della pressione su rilascio, chiusura, perdita di focus o cambio di visibilità.
- `client/ui/interactions/item-art.ts`: disegno procedurale riusabile per l'icona nell'inventario e il mucchio a terra.

L'inventario e i progressi narrativi si salvano sull'account esistente. Gli account precedenti ricevono uno slot vuoto e nessuna missione, conservando personaggio, esperienza e altre informazioni. I mucchi a terra sono temporanei e non sopravvivono al riavvio del server. Raccolta e consumo sono indivisibili nella simulazione; il salvataggio usa il sistema di checkpoint degli account, con flush dopo i comandi di interazione. Le istanze PvP usano copie indipendenti dei dati e non permettono queste interazioni.

La raccolta usa l'indice spaziale dei giocatori; i mucchi sono limitati a 2048. Gli oggetti gettati scadono dopo dieci secondi; bottino e ricompense dopo due minuti. Nessun oggetto viene tolto dall'inventario se il limite impedisce di gettarlo o di produrre le ricompense della consegna. Le sessioni durano al massimo due minuti e i comandi hanno un limite di frequenza sul trasporto.

Questa versione implementa un obiettivo di consegna e l'azione di accettazione. Lo stesso protocollo `use-item` può essere esteso per interazioni con oggetti o portali aggiungendo nuovi tipi di richiesta e validazione server. Un editor visuale delle conversazioni potrà produrre queste definizioni; non è ancora incluso. Ulteriori obiettivi, condizioni, ricompense e comportamenti richiedono di estendere i tipi e i relativi gestori, senza introdurre script arbitrari nei contenuti.

## Verifica

`tests/interactions.test.ts` copre missioni, bottino privato/pubblico, upgrade con inventario pieno, zaini inerti, cura e cooldown, persistenza e isolamento delle stanze. `tests/snapshot-stream.test.ts` verifica anche zaino equipaggiato e contenuti attraverso cache e delta di rete. `tests/integration/quest-browser.test.ts` verifica tre giocatori reali, consegna, ricompense private e raccolta pubblica, con il giocatore touch in orizzontale. `tests/integration/interaction-layout.test.ts` verifica desktop, mobile verticale e due misure orizzontali: cinque slot su una riga, nome/descrizione con pressione prolungata, chiusura dopo uso e tocco esterno, selettore di quantità e controlli simultanei con due dita. I server di prova usano account temporanei e vengono chiusi nel blocco di pulizia del test.
