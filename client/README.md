# Client

`main.ts` avvia il gioco e importa gli stili nello stesso ordine della cascata esistente. `vite-env.d.ts` contiene i tipi Vite. I moduli sono raggruppati per responsabilità; i CSS delle funzionalità stanno accanto ai relativi componenti.

| Cartella | Contenuto |
| --- | --- |
| `core/` | Rete, snapshot, predizione, movimento, presentazione del combattimento, audio e budget dei frame. |
| `controls/` | Tastiera, mouse, touch, comandi e impostazioni della camera. |
| `render/` | Renderer, terreno, attori, minimappa, sprite e asset del mondo. |
| `render/legacy/` | Renderer storico conservato, non importato dagli entry point. |
| `ui/` | Composizione dell'interfaccia, layout, componenti comuni, popup e transizioni. |
| `ui/lobby/` | Menu, scelta del personaggio, build e immagini della home. |
| `ui/hud/` | HUD, feedback XP, diario e pannelli sociali. |
| `ui/interactions/` | Dialoghi, inventario, icone degli oggetti e selettore quantità. |
| `styles/` | Stili generali del gioco e adattamenti touch. |
| `editors/world/` | World Maker, cronologia, salvataggio locale e catalogo degli asset. |
| `editors/dungeon/` | Dungeon Maker, catalogo dei dungeon e prove locali. |

Gli entry point degli editor sono collegati rispettivamente da `world-maker.html` e `dungeon-maker.html`. Le regole condivise rimangono in `shared/`; questa organizzazione non cambia la loro autorità o il comportamento del gioco.

Quando si sposta un modulo, aggiornare anche `new URL(..., import.meta.url)`, i glob Vite, gli import dinamici nei test browser e gli entry point HTML. Gli import relativi mantengono esplicite le dipendenze; non sono introdotti alias o file di re-export per i vecchi percorsi.
