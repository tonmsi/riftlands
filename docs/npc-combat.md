# Combattimento dei mob

I parametri delle specie sono in `shared/npcs.ts`, nella tabella `NPC_COMBAT`.
Le distanze sono pixel del mondo e i tempi sono millisecondi.

| Specie | Pausa prima del colpo | Attesa dopo il colpo | Respawn nel mondo |
| --- | --- | --- | --- |
| Gelatina | 400 ms | 1300 ms | 120 secondi |
| Fuoco fatuo | Nessuna | 1900 ms | 120 secondi |
| Guardiano | 650 ms | 1300 ms | 120 secondi |

I mob in mischia si fermano entro il raggio di attacco e iniziano la pausa
quando possono attaccare. Se il bersaglio cambia, esce dal raggio o non è più
visibile, la pausa viene annullata: devono raggiungerlo e preparare nuovamente
il colpo. I fuochi fatui conservano il comportamento di attacco a distanza.

Le gelatine ignorano la vicinanza dei giocatori. Quando un giocatore ne
danneggia una, anche uccidendola con il primo colpo, le gelatine entro
`aggroRadius` dalla gelatina colpita reagiscono contro quel giocatore.
Devono vedere la gelatina colpita e il giocatore deve essere entro il limite
di inseguimento dalla loro posizione iniziale (650 pixel). L'allarme non si
propaga a catena. Se perdono il bersaglio, tornano alla posizione iniziale e
diventano nuovamente passive. Restano bersagli attaccabili, distinti dagli
NPC di dialogo invulnerabili.

Nei dungeon i mob ordinari rimangono morti fino al reset effettivo dello
scontro: sconfitta del gruppo oppure ritorno del boss dopo il suo cooldown.
L'attesa senza giocatori e la preparazione dell'ingresso non fanno rinascere
i mob. Le morti sono mantenute per la durata della simulazione anche dopo
lo scaricamento dei chunk e la scadenza della cache degli NPC.
Il reset ripristina i mob alla posizione iniziale, con vita piena e senza
aggro. I boss mantengono la propria logica e i propri tempi di respawn.
