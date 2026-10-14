# Corpo delle scale e passaggio inferiore

13 ottobre 2026. Analisi richiesta dopo la prova del laboratorio e successiva correzione del passaggio laterale sotto le scale integrate nella roccia.

## Problema confermato

Prima della correzione il modello creava il supporto `stair:<id>` sopra il terreno originario, lasciando il piano `ground` percorribile. Non distingueva una scala massiccia da una scala sospesa. Una scala da quota0 a3 con supporti intermedi a1/2 conservava `ground` a0 sotto la sua impronta; entrarvi dal fianco non attivava gli accessi della scala.

La verifica iniziale del runtime confermava ingresso laterale attraverso `canTraverse`, `collidesWorld=false` sotto il corpo, movimento nord/sud al piano basso, percorso A* inferiore, linea di vista libera e proiettili senza impatto sulla scala. I test precedenti conservavano esplicitamente il supporto inferiore libero. Il difetto riguardava quindi il modello fisico, non il PNG.

La parete proiettata dal bordo dell’altura e il corridoio inclinato lungo più celle possono coesistere correttamente. La faccia verticale del dislivello non deve necessariamente diventare una fila di celle percorribili. Serve invece rappresentare anche lo spazio occupato dal corpo della scala.

## Correzione applicata

- Scala massiccia per predefinito: volume occupato sotto il tratto inclinato, accesso solo dai pianerottoli e corridoio percorribile sopra.
- Scala sospesa: `underpass: true` consente il passaggio inferiore; campo assente o `false` mantengono la scala massiccia. I ponti continuano a usare piani indipendenti.
- Un’unica query geometrica per volume, movimento, raggio dell’attore e raggi/proiettili; A* eredita le collisioni del movimento.
- Conservare quote e terreno originali. Non dipingere blocchi permanenti nel ground né creare quote artificiali per coprire l’incoerenza.
- Rispettare le corsie parziali, gli ingressi, la scala di una cella, la larghezza e le quattro direzioni. Il blocco non deve occupare tutta una cella laterale quando la scala ne usa solo una frazione.

`shared/stair-volume.ts` indicizza i corpi nello spazio e ricava sezioni orizzontali dal profilo della scala. Movimento, collisioni circolari, A*, spawn, linea di vista e sweep dei proiettili consultano questo volume. I vecchi collegamenti adiacenti derivano un corpo con il loro profilo smoothstep, mantenendo salita e discesa.

World Maker e Dungeon Maker espongono **Scala sospesa · consenti passaggio sotto**, disattivato per default e condiviso fra anteprima e posa. Il flag viene conservato da tutti i formati e dalla ricollocazione. Il renderer omette il corpo minerale per le scale sospese e invalida la cache quando cambia il flag; pianerottoli e gradini restano identici.

Le regressioni comprendono ingresso laterale bloccato e passaggio sospeso libero, salita/discesa, quattro direzioni, scale corte, corsie parziali, raggi sopra/sotto il profilo, ostacoli su altri supporti, navigazione, persistenza e uso nei due editor. La prova browser conferma che il percorso sotto il ponte della scena di riferimento resta libero. Confronto visivo: `artifacts/solid-and-suspended-stairs.png`.

Verifica finale: `npm test` **486/486**, `npm run build` riuscito e quattro prove browser superate (`solid-stair-browser`, `stairs-solid-authoring-browser`, `terrain-reference-browser`).

## Confronto con le fonti

[Side stairs, Essentials Engine](https://essentialsengine.miraheze.org/wiki/Side_stairs) descrive eventi che muovono il giocatore diagonalmente nella griglia mantenendo l’orientamento laterale; distingue scale profonde una o due celle e avverte dei disallineamenti con sprite da mezzo tile. Non definisce i supporti sovrapposti e i volumi del runtime di Riftlands.

[Marin Side Stairs v21](https://eeveeexpo.com/resources/1712/) aggiorna il plugin e rimanda alle istruzioni di [Enhanced Staircases](https://eeveeexpo.com/resources/396/), che definiscono gli accessi fuori dai gradini, `Slope`, `Width` e `Offset`. Queste indicazioni sostengono il raccordo coerente fra ingresso, profilo e uscita; non risolvono automaticamente il volume inferiore nel nostro motore.

La pagina Miraheze non era leggibile dal tool web, ma è stata letta integralmente dall’API MediaWiki pubblica (`action=parse`, `prop=wikitext`, pagina `Side_stairs`).
