# Istanze PvP: fondazione

Il runtime usa un `RoomManager` unico. `global` mantiene il mondo procedurale e le regole precedenti, incluso PvP libero e corpo vulnerabile per 20 secondi dopo ogni uscita. Non sono state aggiunte safe zone, valute o ricompense.

## Creazione e chiusura

L'arena 1v1 è accessibile dal cerchio azzurro a nord del Crocevia, centro `(0, -360)`, raggio 90. L'accesso è fisico: due giocatori idonei nel cerchio vengono abbinati dal server. Parte una preparazione di un secondo con movimento libero; uscire, morire, entrare in combattimento o disconnettersi annulla l'abbinamento. Un eventuale sostituto deve attendere un nuovo secondo completo. Se ci sono più giocatori, il server abbina prima chi è in attesa da più tempo. Ogni partecipante entra individualmente, anche se appartiene a un gruppo.

Il campo 1v1 misura 864 × 672 unità, con quattro pilastri simmetrici che bloccano movimento e proiettili. Non ci sono NPC o pickup. Un singolo round dura al massimo tre minuti; eliminazione o abbandono dell'avversario conclude il duello, scadenza del tempo dà pareggio. Il risultato è mostrato come messaggio, senza ricompense persistenti.

Al ritorno bisogna uscire dal cerchio e rientrare per iscriversi nuovamente. Anche un nuovo accesso con posizione salvata nel cerchio richiede questa conferma fisica. Non esiste una safe zone: resta il requisito di vita e 10 secondi fuori combattimento previsto dai trasferimenti (anche dopo l'accesso iniziale).

La creazione resta un'API **interna al server**, utilizzata dall'ingresso fisico e disponibile per i futuri accessi 2v2/BG. Non è un messaggio che un client può inviare per trasferire arbitrariamente altri giocatori.

```ts
const roomId = rooms.createMatch('arena', [[playerA], [playerB]]);
// oppure: rooms.createMatch('battleground', [[a, b], [c, d]], 600);
rooms.closeMatch(roomId);
```

Il chiamante futuro dovrà raccogliere il consenso dei partecipanti. Il manager controlla presenza, unicità, capienza, squadre della stessa dimensione, vita e assenza di combattimento da almeno 10 secondi. Queste condizioni riguardano solo il trasferimento, non cambiano il PvP globale.

Sono consentite al massimo 16 istanze, con 1–3 giocatori per squadra in arena e 1–5 in BG; sono salvaguardie, non capacità misurate. I posti nel mondo globale restano riservati a chi è in partita. Le mappe provvisorie sono campi delimitati, identici su client e server, senza NPC o pickup. Non sono mappe definitive.

Arena: singolo round, nessun respawn; chiusura quando rimane meno di una coppia di squadre con personaggi vivi o scade il tempo. BG: respawn nella propria metà campo, chiusura a tempo o quando una squadra non ha più partecipanti. Sono regole minime per esercitare il ciclo di vita; punteggi, obiettivi, round multipli e risultati persistenti sono ancora da aggiungere.

## Sessioni

- Ogni account occupa una sola istanza. Trasferire rimuove subito corpo, input, trappole e proiettili posseduti dalla simulazione precedente.
- Caduta della connessione in partita: corpo vulnerabile e posto riservato per 20 secondi. Il rientro riprende corpo, classe e cooldown esistenti; cambiare classe nel login non cambia quella della partita.
- Uscita esplicita dal menu o logout in partita: abbandono immediato. Il successivo accesso avviene nel mondo globale. Se il messaggio di uscita non arriva, si applica la normale scadenza di disconnessione.
- Sessione duplicata: la nuova sostituisce la precedente. La chiusura del vecchio socket non disconnette il nuovo. Gli errori non relativi all'autenticazione non cancellano il JWT locale.
- Fine partita: gli utenti connessi tornano al mondo; gli offline rientrano nel mondo al prossimo accesso. Stanze vuote e scadute vengono eliminate. `closeMatch` può essere richiamato dopo la chiusura senza effetti.
- Gruppi globali conservati durante la partita; modifica dei team bloccata per i partecipanti in istanza. Le squadre della partita sono indipendenti dai gruppi globali.

## Persistenza e protocollo

Prima dell'ingresso viene salvato lo stato globale. Ogni partita usa copie degli account: XP, kill, morti, posizione e salute della partita non sovrascrivono il personaggio persistente. Uscita e riavvio recuperano lo stato globale precedente; la progressione economica futura dovrà avere un percorso esplicito di assegnazione ricompense.

Il protocollo è versione 2: dopo `welcome` e a ogni trasferimento il server invia `room` prima dello snapshot. `roomId` ed `epoch` accompagnano ogni input; comandi di un contesto precedente sono ignorati. Il client azzera predizione, buffer remoti, selezione, effetti e camera al cambio stanza. Pubblicare client e server insieme.

Tutte le istanze condividono processo e clock; non c'è distribuzione tra VPS né isolamento dei crash per stanza. Il JSON mantiene un solo autore delle scritture.

## Verifica

- `npm test`: simulazione, stanze, disconnessioni, ripristino dopo riavvio e regressioni del mondo.
- `npm run build`: TypeScript e client di produzione.
- `node --import tsx --test tests/integration/sessions.test.ts` dopo la build: server di produzione locale temporaneo e socket reali, con account in una directory temporanea; il processo viene chiuso a fine test.

`node --import tsx --test tests/integration/arena-browser.test.ts` dopo la build verifica due browser reali: ingresso, cancellazione, duello e abbandono. Su Windows usa Chrome; `PLAYWRIGHT_CHANNEL` consente di scegliere un altro canale installato. Le schermate sono in `test-results/arena-entrance.png` e `test-results/arena-duel.png`. Il server usa esclusivamente account temporanei ed è chiuso a fine prova.

Passo successivo: accessi 2v2 per gruppi e BG, con consenso/gestione del roster, obiettivi e punteggi. Non sono ancora attivi. Gold e gemme rimangono una fase separata.
