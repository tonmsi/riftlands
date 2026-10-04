# Personaggi, esperienza e build

Ogni account ha un personaggio per classe, con lo stesso nome visibile. XP, livello, build, inventario e missioni sono separati per classe. Gold, amici e statistiche sociali restano sull'account. La classifica somma l'XP delle classi ordinarie; il Cacciatore per sviluppatori non contribuisce alla somma.

## Livelli e abilità

Il limite attuale è 20. Il Cacciatore parte già al livello 20 e conserva salute, velocità e abilità del catalogo originale. Usa le stesse regole e gli stessi costi delle altre classi.

| Livello | Sblocco |
| --- | --- |
| 1 | Attacco base fisso e abilità A su Q |
| 2 | Abilità B disponibile; Q può contenere A oppure B |
| 5 | Secondo slot E; A e B occupano i due slot |
| 10 | Abilità C disponibile; si scelgono due abilità diverse fra A/B/C |
| 20 | Livello massimo; gemme previste in una fase successiva |

L'attacco base resta quello della classe. Il catalogo mantiene gli identificatori storici `q/e/r` delle tre abilità, ma i pulsanti effettivi sono `basic/q/e`. Non esiste un quarto attacco simultaneo. Il Dungeon Maker offline conserva invece il catalogo completo per le prove locali.

Per passare dal livello L al successivo servono `100 + 40 × (L − 1)` XP; per raggiungere il livello 20 servono 8740 XP totali. Il livello non aumenta automaticamente vita, danni o velocità. Il client anima l'XP confermata dal server e mostra `+N XP` vicino alla barra; ingresso, riconnessione e cambio classe non simulano ricompense arretrate. A livello massimo la barra è piena.

## Ricompense

- Mob: `20 + 3 × livello del mob` XP; oltre tre livelli di vantaggio del giocatore il premio diminuisce progressivamente fino al 10%, arrotondato per difetto. Riceve XP chi infligge il colpo finale.
- Boss: `100 + 10 × livello del boss` XP per partecipante del relativo incontro, compresi i ruoli di supporto. Per un incontro con più boss, il premio arriva alla conclusione del gruppo.
- Nereo: ripetibile cinque minuti dopo il completamento, anche offline. XP per completamento: 150, 75, 37, 18, 9, 5, 5…; 20 gold soltanto al primo completamento di quel personaggio. Le consegne parziali e i comandi ripetuti non duplicano premi.
- PvP nel mondo e arena: nessuna XP per uccisioni o risultati.
- Battleground completato: 150 XP per vittoria, 75 per sconfitta, 100 per pareggio. Abbandono e chiusura amministrativa non premiano. Nessuna XP per singola uccisione. I premi sono applicati al personaggio persistente al ritorno nel mondo.
- Gli eventi futuri possono assegnare premi tramite il metodo autorevole `awardXp`; non viene introdotto un evento né un comando client per assegnarsi XP.

Il dungeon rimane accessibile senza un vincolo di livello; per affrontare il primo contenuto con entrambi gli slot si consiglia il livello 5. La difficoltà effettiva dipende dal dungeon e richiede bilanciamento.

## Modifica della build

La schermata del personaggio permette di modificare Q/E prima di entrare. La prima modifica dopo uno sblocco è gratuita. Le successive modifiche della combinazione costano 10 gold per salvataggio; invertire Q/E o inviare nuovamente la stessa configurazione è gratuito. Il portafoglio è condiviso fra le classi.

Il server verifica autenticazione, abilità sbloccate, assenza di doppioni, saldo e stato del giocatore. Non si può cambiare build mentre si è in partita, morti o nei dieci secondi successivi al combattimento. I recuperi non vengono azzerati: il massimo recupero residuo viene mantenuto per gli slot delle abilità.

La build occupa un'area ampia su PC. Play è subito sotto l'immagine del personaggio, prima della build. Premendo Q/E nella schermata del personaggio si apre una ruota con le tre abilità, le icone circolari, la scelta attuale e gli sblocchi richiesti. Se si sceglie l'abilità dell'altro slot, le due vengono scambiate. Esc o il pulsante di chiusura lasciano la build intatta; il salvataggio mantiene le regole dei gold. Le sprite originali restano utilizzate senza un segno aggiuntivo a terra. Il pannello del bersaglio elenca le abilità equipaggiate.

La barra XP accompagna il conteggio con un'etichetta animata. Il livello nel box del player è un piccolo numero circolare sul bordo inferiore del ritratto. Al passaggio di livello il numero compare per 1,4 secondi al centro dello schermo, il cerchio pulsa e un breve gruppo di coriandoli appare vicino alla barra. L'overlay lascia passare i comandi; gli effetti vengono rimossi alla fine o al cambio sessione. Con movimento ridotto viene mostrato il testo senza movimenti o particelle.

## Persistenza e verifica

`Account.characters` contiene i progressi per classe. I campi storici `inventory/narrative` puntano alla classe attiva, per mantenere un unico percorso delle transazioni esistenti. Lo stato fisico continua a rispettare le regole di logout e cambio classe, senza cure gratuite. Le stanze temporanee clonano anche i personaggi e non possono modificare inventario o missioni del mondo.

Client e server richiedono il protocollo 10. `tests/progression.test.ts` verifica progressione, separazione, salvataggio, costi, XP e comportamento delle abilità spostate; `tests/integration/progression-browser.test.ts` verifica menu desktop/touch, API e animazione XP usando un server temporaneo e account di prova, chiusi alla fine.
