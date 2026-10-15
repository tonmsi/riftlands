# Merge di cazzeggio in cazzeggio-building

Confronto tra `cazzeggio` (`acfb034`) e `cazzeggio-building` (`4dc57c6`), con base comune `b8eac75`.

La generazione procedurale del mondo era già identica nei due branch. Le aggiunte a `World` nel branch building espongono le stanze dungeon; non cambiano l'algoritmo di generazione. Il merge mantiene queste aggiunte e la logica dei trasferimenti di `cazzeggio`, estesa agli ingressi con più tile e al controllo della stanza di provenienza.

| Area | Risultato |
| --- | --- |
| World Maker e Dungeon Maker | Strumenti e organizzazione di building: trascinamento, passaggi A/B, stanze a forma libera, regioni degli incontri, dungeon senza boss obbligatorio. |
| Mappa salvata e dungeon | Contenuti di building, inclusi interni e collegamenti esistenti. La diversa mappa salvata di cazzeggio non sostituisce quella di building. |
| Asset e cataloghi | Asset di building, sincronizzazione delle cartelle e percorsi annidati; aggiunti anche i nuovi pavimenti presenti in cazzeggio. |
| Rendering | Ordinamento e pivot per istanza di building, con le correzioni compatibili di cazzeggio. |
| Visibilità dungeon | Stanze e filtri di building su client e server; mantenuti anche i confini per movimento, combattimento, proiettili e interazioni, così i contenuti nascosti non possono interagire tra stanze. |
| Warp | Trasferimenti, dissolvenza, riconnessione, persistenza e protezione dal ritorno immediato di cazzeggio; mantenute dimensioni 1×1, 2×1, 1×2, 3×1 e 1×3 di building. Gli ingressi 1×1 conservano il raggio precedente. |
| NPC | Proprietà per singolo piazzamento di building. Senza valori personalizzati valgono i valori del modello. |
| Controlli mobile | Correzioni di cazzeggio per scorrere le opzioni senza modificare involontariamente i cursori. |
| Chiavi dei passaggi | Rimosse da editor, comandi di rete, server, snapshot, inventario, persistenza e rendering. I vecchi requisiti nei progetti importati vengono scartati. |

Le proprietà NPC aggiunte da building sono nome, dialogo, velocità, raggio di movimento, aggro, distanza massima dall'origine, respawn e direzione iniziale. Non sostituiscono il comportamento base della specie: lo personalizzano solo per l'istanza configurata. Nei dungeon resta la regola precedente dei cadaveri fino al reset dell'incontro. Le stanze impediscono inoltre agli NPC di vedere o colpire giocatori nelle altre stanze.

Il merge è locale; non comporta pubblicazione o push dei branch.
