# Riftlands

Prototipo multiplayer 2D dall’alto, senza asset: mondo procedurale, combattimento PvP/PvE e alleanze. Client Canvas e TypeScript, server Node.js autorevole con WebSocket. Il menu e tutti i comandi sono in italiano.

## Avvio

Serve **Node.js 22.12 o successivo** (verificato con Node 24). Nella cartella del progetto:

```powershell
npm install
npm run dev
```

Apri **http://localhost:3000**, inserisci il nome, scegli la classe ed entra. Un solo processo serve client e WebSocket. Per provare due giocatori sullo stesso PC usa **due browser diversi o una finestra privata**: due schede dello stesso browser condividono l’account e l’ultima sostituisce la sessione precedente.

Il client si aggiorna automaticamente durante lo sviluppo. Dopo modifiche a `server/` o alle regole in `shared/`, riavvia `npm run dev` per mantenere client e server allineati.

Per giocare sulla stessa rete, gli altri dispositivi aprono `http://IP-DEL-PC:3000`. Il server ascolta su `0.0.0.0`; potrebbe essere necessario consentire Node nel firewall di Windows. Per giocare da Internet serve un host raggiungibile con supporto WebSocket: questo progetto non è stato pubblicato su un servizio esterno.

```powershell
npm test            # simulazione, fisica, generazione e riconciliazione
npm run typecheck   # verifica TypeScript
npm run build      # verifica TypeScript e crea dist/
npm start          # serve la build e il server autorevole
npm run test:e2e    # test di due giocatori reali e interfaccia nel browser
```

I test browser usano Edge su Windows. Su Linux/macOS installare Chromium con `npx playwright install chromium`. Il server di test si avvia automaticamente se la porta 3000 è libera; può anche riutilizzare quello già avviato. I test browser creano account di prova nell’archivio del server utilizzato.

## Comandi e classi

Dal menu principale, **Opzioni → Controlli** permette di cambiare i comandi di movimento, attacco base e abilità, con un'associazione principale e una alternativa. **Salva controlli** applica le modifiche e le conserva sul dispositivo; **Annulla** scarta le modifiche. **Ripristina predefiniti** ripristina la configurazione iniziale, da confermare con Salva controlli. Durante una partita le opzioni non sono disponibili: occorre tornare al menu principale.

La modalità **Segui il cursore** muove il personaggio verso il puntatore mentre si tiene premuto il comando configurato (mouse destro per impostazione iniziale). Il rilascio arresta il movimento; il personaggio si ferma vicino al cursore e collide normalmente con gli ostacoli, senza calcolare un percorso. Il clic sinistro seleziona; tenendolo premuto si attiva la mira manuale con anteprima direzionale. Senza il sinistro, gli attacchi si orientano verso il nemico visibile più vicino. Passando a questa modalità, il destro viene rimosso dall'attacco base, che resta su Spazio; eventuali altri conflitti tra movimento e attacchi vengono risolti e mostrati nelle opzioni. Le associazioni duplicate attive vengono rifiutate.

`client/controls.ts` separa input fisici e azioni di gioco. `client/mobile-controls.ts` gestisce il joystick analogico e le dita indipendenti: trascina qualsiasi abilità direzionale per mirare e rilascia per usarla; un tocco mira automaticamente al nemico visibile più vicino. La scelta avviene sul server, esclude alleati, morti, nemici protetti o nascosti e richiede linea di vista libera; nei cespugli valgono le regole esistenti di rivelazione e prossimità. Senza bersagli validi si mantiene la direzione corrente. Ogni `AbilityDef` dichiara obbligatoriamente `targeting: 'directional' | 'self'`: proiettili, colpi frontali, scatti e trappole sono direzionali, mentre cure, scudi e aree centrate sul personaggio si attivano con un tocco. Il pulsante e l'anteprima usano la definizione dell'abilità selezionata, indipendentemente dalla sua posizione nella barra. Il joystick non cambia la direzione di mira. La selezione di giocatori e creature avviene ancora toccandoli nel mondo. Gesti annullati, cambio di orientamento, perdita del focus e disconnessione rilasciano gli input.

Su dispositivi touch, l'ingresso richiede subito il fullscreen con `navigationUI: 'hide'` e prova a bloccare l'orientamento landscape. Il gioco resta utilizzabile anche in portrait o se il browser rifiuta il fullscreen; il pulsante **Schermo intero** consente di riprovare. Il primo Indietro durante la partita apre la conferma d'uscita. Uscire ripristina scorrimento, orientamento e presentazione del menu. CSS limita overscroll, pull-to-refresh e gesti sulle superfici di gioco; le gesture riservate al sistema operativo e l'effettiva disponibilità del fullscreen rimangono sotto il controllo del browser/dispositivo. `client/game-display.ts` concentra questa integrazione per il futuro wrapper Android.

HUD touch e desktop condividono dati, abilità e cooldown. `client/mobile.css` organizza le aree touch con margini per notch e barre di sistema, pulsanti di almeno 44 px e layout dedicati a portrait, landscape e tablet. Canvas del mondo e minimappa si ridimensionano alla superficie disponibile e alla densità del display (massimo DPR 2). In arena touch la camera segue il personaggio senza rimpicciolire gli attori per far entrare tutta la mappa. **Mostra/Nascondi mappa** funziona anche su PC e salva la preferenza localmente; sui dispositivi touch la mappa è inizialmente nascosta.

| Comando | Azione |
| --- | --- |
| WASD / frecce | Movimento |
| Mouse | Mira |
| Spazio / tasto destro tenuto | Attacco base ripetuto |
| Q / E / R | Abilità della classe |
| Clic sinistro su un personaggio | Seleziona, mostra vita e azioni sociali |
| Compagni | Giocatori vicini, richieste, amici e team |
| Esci | Torna al menu e consente di cambiare classe |

Su schermi touch ci sono joystick e attacchi circolari: trascina le abilità direzionali per mirare, tocca i personaggi per selezionarli. Le sprite dei giocatori su mobile usano settori cardinali con isteresi: una lieve componente laterale non impedisce più di mostrare nord e sud.

| Classe | Risorsa | Attacco base | Q | E | R |
| --- | --- | --- | --- | --- | --- |
| Mago | Mana, 120 | Dardo arcano | Lancia di gelo, rallenta | Nova ad area | Velo astrale, scudo |
| Guerriero | Rabbia, 100 | Fendente, genera rabbia sui colpi | Spaccaterra a cono | Carica | Turbine ad area |
| Paladino | Mana, 100 | Colpo sacro | Giudizio a distanza | Cura personale e del team | Scudo personale e del team |

Mana: rigenerazione di 7/s. Rabbia: generata infliggendo/subendo danni, decade fuori dal combattimento. Gli attacchi base non consumano risorse. Tutte le abilità hanno recuperi verificati dal server. I valori si modificano in `shared/config.ts`; il client mostra le stesse definizioni.

## Mondo e regole

- Terreno deterministico in chunk da 16 × 16 caselle, ciascuna da 48 unità. Il mondo cresce esplorando in qualsiasi direzione; il seed determina le stesse zone per tutti. Le coordinate salvate sono validate entro ±1 miliardo di unità. “Infinito” significa generazione su richiesta, entro i limiti numerici del motore.
- Praterie, foreste, acquitrini e sentieri continui. Acqua e rocce bloccano personaggi e attacchi; il fango riduce la velocità. Le collisioni tra personaggi sono risolte dal server.
- Nei cespugli i nemici oltre 120 unità non vengono inviati al client. Attaccare o ricevere danni rivela per 2,5 s. Il team resta visibile entro il raggio di interesse.
- Gelatine, fuochi fatui e guardiani vengono generati insieme ai chunk. Inseguono, attaccano e tornano alla zona d’origine; gli NPC morti ricompaiono dopo 35 s. I nemici diventano più forti allontanandosi dall’origine.
- Fonte vitale: +35 salute. Passo celere: +35% velocità per 10 s. Potere antico: +30% danni per 10 s. Maledizione: −30% danni per 7 s. I raccoglibili tornano dopo 35 s.
- Alla morte il giocatore ritorna all’origine dopo 5 s e ottiene 5 s di protezione; usare abilità termina la protezione. Salute recuperata lentamente fuori combattimento. Livelli/XP e statistiche persistono; per ora il livello del giocatore è progressione visibile, senza talenti o aumento automatico delle statistiche.
- PvP libero. L’amicizia è una relazione sociale: **solo appartenere allo stesso team impedisce il fuoco amico**. Amicizie e ingressi nei team richiedono accettazione esplicita. Team fino a 5 persone; i team sono temporanei e non persistono attraverso il riavvio del server.
- Dopo l’uscita il personaggio resta nel mondo per **20 s**, esposto al combattimento. Rientrare o cambiare classe non ripristina gratuitamente vita e risorse.

## Account e salvataggi

Il browser conserva un token casuale in `localStorage`, chiave `riftlands.account`; il server conserva soltanto il suo hash. Nome, XP, statistiche, corpo del personaggio e amicizie sono in `data/accounts.json`, salvati tramite sostituzione atomica. Nuove identità e azioni sociali vengono salvate subito, i personaggi ogni 5 s e in chiusura regolare. Un arresto improvviso può perdere gli ultimi secondi di progressione. Un archivio danneggiato causa un errore esplicito e non viene sovrascritto.

Conserva la cartella `data` quando aggiorni il server. Nel menu, **Codice account** permette di copiare il codice, importarne uno conservato o creare esplicitamente un nuovo profilo. Conserva il codice prima di cancellare i dati del browser; non esiste ancora recupero tramite email/password. Il token è una credenziale: non condividerlo. L’IP serve solo ai limiti anti-abuso, non all’identità. La copia negli appunti richiede localhost o HTTPS.

## Struttura

```text
client/
  main.ts          Input, ciclo grafico e collegamento dei moduli
  net.ts           WebSocket, sessione, ping, riconnessione con backoff
  prediction.ts    Previsione locale, riconciliazione e interpolazione
  motion.ts        Interpolazione grafica locale fra tick della simulazione
  snapshots.ts     Buffer remoto adattivo agli arrivi dei pacchetti
  render.ts        Rendering geometrico e minimappa sostituibili con asset
  ui.ts            Menu, HUD e relazioni sociali
  style.css        Stili dell’interfaccia
shared/
  types.ts         Contratto del protocollo e modelli dati
  config.ts        Classi, abilità, bilanciamento e frequenze
  dungeons.ts      Catalogo data-driven di geografia, accessi, barriere e temi dei dungeon
  world.ts         Generazione deterministica e cache limitata
  physics.ts       Movimento, collisioni, raggi e proiettili
server/
  index.ts         HTTP, WebSocket, validazione, clock e ciclo di vita
  simulation.ts    Stato autorevole, combattimento, NPC, chunk e socialità
  store.ts         Identità e archivio account
tests/             Test della logica e test browser con due client
```

Le grafie Canvas sono placeholder: per aggiungere sprite, tilemap, animazioni o audio si interviene sul livello di presentazione, mantenendo hitbox e regole nella simulazione. Per aggiungere classi si estendono i tipi e le definizioni condivise; per nuovi effetti/comportamenti si aggiungono sistemi alla simulazione. La versione del protocollo impedisce accessi di client incompatibili.

### Architettura dei dungeon

`shared/dungeons.ts` è la fonte unica per geografia, passaggi e regole spaziali dei dungeon. Ogni `DungeonDefinition` descrive identità, area, layout, spawn, percorso di accesso, tema e passaggi nominati. Ogni passaggio ha un solo stato durante il fight: `stone`, `flame` oppure `open`. Il tipo discriminato e il validatore impediscono che lo stesso varco contenga contemporaneamente pietre e fiamme.

Le mappe sono composte sulla griglia di tile del mondo: `layout.bounds` delimita l'area curata, `layout.obstacles` descrive muri rettangolari e `layout.obstacleTiles` consente correzioni puntuali. Il resto dell'area usa `layout.floor`. Le sei regioni dell'incontro (`trigger`, `admission`, `combat`, `ejectIntruders`, `bossAggro`, `bossLeash`) sono indipendenti e accettano cerchi o poligoni; `ejectTo` stabilisce dove riportare gli intrusi.

Mondo, server e client consumano lo stesso catalogo: soltanto i passaggi `stone` diventano collisioni solide; i passaggi `flame` restano attraversabili e applicano le regole di partecipazione; quelli `open` non cambiano. Il validatore eseguito all'avvio controlla coordinate, regioni, spawn, tile solide, passaggi duplicati, sovrapposizioni pietra/fiamma e aperture di bordo non dichiarate. `BossDefinition` contiene soltanto combattimento e comportamento: non duplica più spawn, barriere o raggi della mappa.

I punti di modifica principali sono volutamente concentrati: la forma della mappa è in `layout`, i varchi sono in `passages`, l'aggro è in `encounter.regions.bossAggro` e il limite fisico del boss è in `bossLeash`. Parametri puramente comportamentali, incluso l'eventuale recupero `behavior.unstuck`, appartengono invece alla relativa voce in `shared/bosses.ts`.

Per aggiungere un dungeon:

1. aggiungere una `DungeonDefinition` e registrarla in `DUNGEON_DEFINITIONS`;
2. aggiungere la sua `BossDefinition`, collegata con `dungeonId` e `bossId`;
3. aggiungere gli asset o una resa particolare solo se il fallback procedurale e il tema generico non bastano;
4. aggiungere test sui dati e sulle eventuali meccaniche davvero specifiche.

Combattimento, team, aggro, lock, eliminazione, respawn, ricompense, terreno, esclusione degli spawn e indicatori non vanno duplicati per dungeon.

## Rete e limiti attuali

Il server simula a **30 Hz** e invia snapshot a **10 Hz**, filtrati per interesse spaziale. Accetta comandi sequenziali di durata fissa, non posizioni, danni o delta temporali scelti dal client. Il client predice solo il movimento, torna alla posizione confermata e rigioca i comandi non ancora riconosciuti. Il rendering locale interpola tra gli ultimi due tick, alla frequenza del display: aggiunge al massimo un tick grafico (33 ms), senza cambiare hitbox o velocità della simulazione. Le piccole correzioni vengono assorbite gradualmente; morte, respawn e grandi spostamenti azzerano la storia grafica.

Gli altri personaggi e i proiettili usano un buffer adattivo di **150–300 ms rispetto agli arrivi dei pacchetti**, indipendente dalle correzioni dell’orologio del ping. Il tempo di riproduzione avanza continuamente e non torna indietro al ricevimento di uno snapshot. Se la rete si interrompe, conserva l’ultima posizione nota anziché inventare movimento attraverso gli ostacoli. Vita, proiettili, risorse, cooldown e raccolte restano autorevoli. C'è rilevamento dei proiettili lungo il segmento percorso fra tick e controllo di visibilità per gli attacchi attraverso ostacoli.

Le code sono limitate; input accumulati troppo vecchi vengono scartati. Rate limit, limiti di payload, heartbeat, backpressure e gestione delle sessioni duplicate evitano alcuni abusi e accumuli. Gli NPC sono attivi nei chunk circostanti, le zone abbandonate vengono scaricate dopo 20 s, le cache hanno limiti e scadenze. Gli scontri usano celle spaziali per ridurre il numero di confronti.

Questa è una **base funzionante su un singolo server**, non un’infrastruttura MMO già dimensionata per migliaia di utenti. Il tetto configurato di 128 giocatori è una protezione, **non una capacità certificata da un test di carico**. Rimangono da sviluppare:

- Database transazionale e migrazioni, backup operativi, recupero account e autenticazione completa.
- Partizionamento del mondo, trasferimento tra server, bilanciamento del carico e chat/moderazione.
- Compensazione della latenza sugli attacchi tramite rewind validato: per ora conta il tempo di ricezione del comando sul server; la riconciliazione del movimento è già presente.
- Navigation/pathfinding evoluto per gli NPC: attualmente seguono il bersaglio con collisioni, linea di vista e ritorno all’origine, ma non pianificano percorsi intorno a grandi ostacoli.
- Persistenza delle modifiche al mondo: il terreno è deterministico, mentre stato NPC e raccoglibili restano in memoria e si rigenerano al riavvio.
- Test di carico, metriche, protezione DDoS, TLS e deployment pubblico. WebSocket usa TCP: la consegna ordinata comporta compromessi su reti con forte perdita di pacchetti.

Riferimenti tecnici usati: [ws — documentazione ufficiale](https://github.com/websockets/ws/blob/master/README.md), [Gaffer on Games — sincronizzazione dello stato](https://gafferongames.com/post/state_synchronization/).

## Distribuzione

Le variabili disponibili sono `PORT` (default 3000), `HOST` (default 0.0.0.0), `DATA_FILE` (percorso del file account) e `NODE_ENV=production`. In produzione esegui la build, monta uno storage durevole e usa un reverse proxy HTTPS che inoltri gli upgrade WebSocket a `/ws`. Il client sceglie automaticamente `wss://` quando la pagina usa HTTPS. Mantieni lo stesso host per pagina e WebSocket, perché il server verifica l’Origin.

È incluso un `Dockerfile` e un `compose.yaml` per costruire ed eseguire il singolo server con volume persistente:

```sh
docker compose up --build -d
```

`GET /health` restituisce stato, giocatori online, frequenze, numero di NPC/chunk attivi e costo dell’ultimo ciclo. Il packaging Docker è predisposto; i test locali non richiedono Docker.
