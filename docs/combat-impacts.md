# Impatti di combattimento

Gli eventi `hit` confermati dal server possono includere `impact`: posizione del contatto, direzione in ingresso, colore dell'abilità, tipo (`melee`, `projectile`, `area`) ed esito (`hit`, `shield`, `wall`). Le coordinate principali dell'evento restano quelle del bersaglio per i numeri del danno; quelle di `impact` ancorano l'animazione nel mondo, anche se il bersaglio si sposta dopo il colpo.

Il client disegna gli effetti in Canvas JavaScript dopo gli attori e i proiettili della stessa quota. Il melee usa due tagli corti e scintille, il ranged un piccolo impulso circolare, gli attacchi ad area un impulso più largo. I colori seguono l'abilità; lo scudo usa un arco azzurro e gli ostacoli scintille color pietra rivolte verso l'attaccante. Le animazioni durano 260–320 ms. Con movimento ridotto rimane un simbolo di 180 ms senza particelle in movimento.

Gli scudi attuali assorbono il 60% del danno: l'effetto di assorbimento accompagna il danno residuo e non introduce una parata totale. Pareti e ostacoli generano un contatto per i proiettili e per il melee diretto verso di loro, senza numeri di danno o lampi su un bersaglio. Scadenze dei proiettili, colpi a vuoto e attacchi rifiutati non generano impatti. Le regole del combattimento restano autorevoli sul server.

Il renderer è privo di stato: usa ID e tempo dell'evento per disegnare al massimo nove scintille, senza timer o nuove risorse grafiche. Snapshot ripetuti non riavviano l'animazione. Gli attacchi condividono un linguaggio visivo per tipo ed esito; eventuali effetti unici per abilità potranno essere aggiunti sopra questa base.

Verifiche: `tests/combat-impact.test.ts` controlla colpi, assorbimento, punti di contatto e ostacoli; `tests/integration/combat-impact-browser.test.ts` controlla i disegni, la loro scadenza, l'orientamento, il movimento ridotto e il ripristino del contesto Canvas. Produce una galleria in `.tmp/combat-review/impacts.png`.
