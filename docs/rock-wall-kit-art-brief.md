# Kit definitivo di pareti rocciose: specifiche degli asset

## Ingombro verificato nel motore

La cella fisica misura 48×48 px. Un livello di quota solleva la superficie di 16 px. La parete collega il bordo della sommità al piano vicino: la sua altezza visibile è `differenza di quota × 16`, senza una cella fisica aggiuntiva.

| Differenza di quota | Fronte visibile | Altezza complessiva di un tile isolato, sommità inclusa |
|---:|---:|---:|
| 1 | 16 px | 64 px |
| 2 | 32 px | 80 px |
| 3 | 48 px | 96 px |
| 6 | 96 px | 144 px |

Non esiste un’aggiunta fissa di mezzo tile (24 px). I fianchi hanno uno smusso grafico fra circa 7 e 12 px, dipendente dall’altezza; labbro, piede e ombre aggiungono piccoli dettagli. Queste estensioni non allargano la collisione. I margini usati per riempire le texture vengono ritagliati sul profilo del terreno.

## Direzione artistica

Conservare lo stile illustrato e sfaccettato di Riftlands: roccia grigio-blu, luce dall’alto a sinistra, crepe poco contrastate e massi leggibili alla scala del personaggio. La griglia tecnica da 48 px non richiede pixel art. Nessuna prospettiva isometrica nuova: la camera del gioco solleva le superfici verticalmente sullo schermo.

I file rappresentano componenti della parete, non plateau o montagne completi. Il renderer fornisce la sagoma, i fianchi, la curvatura degli angoli e le aperture delle scale. Evitare grandi margini trasparenti, ombre proiettate esterne e terreno incorporato nel corpo. La superficie superiore conserva il proprio materiale.

## PNG da produrre

| File | Dimensione di lavoro | Contenuto |
|---|---:|---|
| `body.png` | 48×48 | Corpo minerale opaco e ripetibile, largo una cella e alto tre fasce di quota |
| `cap.png` | 48×8 | Labbro minerale superiore sottile, raccordabile in orizzontale |
| `foot.png` | 48×8 | Piede roccioso con poche pietre basse e ombra di contatto contenuta |
| `back.png` | 48×6 | Bordo posteriore discreto, verso nord |
| `side-left.png` | 48×48 | Texture del fianco ovest, con illuminazione coerente |
| `side-right.png` | 48×48 | Texture del fianco est, più in ombra |
| `corner-left.png` | 48×48 | Raccordo esterno sinistro, con dettagli trasparenti sopra il corpo |
| `corner-right.png` | 48×48 | Raccordo esterno destro, senza specchiare automaticamente la luce |
| `inner-corner-left.png` | 48×48 | Rientranza sinistra, con ombra e crepe proprie |
| `inner-corner-right.png` | 48×48 | Rientranza destra, allineata al corpo ripetibile |

48×16 è valido per il corpo, ma ripeterebbe la stessa fascia ogni singola quota. 48×48 permette una composizione minerale più varia; il motore mostra una porzione della texture per i dislivelli di 1 o 2 quote e la ripete per le pareti più alte. Un corpo largo 96 o 144 px è una variante possibile dopo aver validato il modulo iniziale, per rendere meno evidente la ripetizione.

Cap, piede e bordo posteriore usano alpha reale dove necessario. Gli angoli sono raccordi sopra il corpo: non devono introdurre cornici rettangolari o una nuova sagoma tridimensionale. I fianchi vengono campionati dentro uno smusso stretto, quindi i dettagli vanno verificati nella proiezione effettiva. L’ancoraggio degli angoli esterni e interni va provato prima di rifinire tutti i PNG: un angolo può essere ritagliato a metà quando entrambi i terminali occupano la stessa cella.

## Produzione e controllo

1. Produrre il prototipo con **body, cap e foot**. Allineare palette, scala delle pietre e continuità dei giunti.
2. Provarlo su pareti lunghe con dislivelli 1, 2, 3 e 6. Confrontare sempre la cella fisica, la sommità e la faccia proiettata.
3. Completare fianchi e angoli sulla stessa base. Verificare pilastro, L, T, anello, rientranze e terrazze annidate; nessuna fessura o doppio terminale nei giunti.
4. Verificare gli accessi delle scale nelle quattro direzioni e la separazione dal ponte. Il PNG deve lasciare libere le aperture definite dalla geometria.
5. Salvare il kit definitivo come `public/terrain-walls/wall-roccia-v1`, mantenendo disponibile l’esempio attuale. Il catalogo riconoscerà la cartella dai nomi dei PNG.

Configurazione prevista:

```json
{
  "name": "Roccia sfaccettata",
  "material": "rock",
  "tileSize": 48,
  "levelHeight": 16,
  "pixelated": false
}
```

Le parti delle scale possono essere aggiunte in seguito alla stessa famiglia: `stairs-tread.png`, `stairs-riser.png`, `stairs-border.png` e `stairs-landing.png`. Il pianerottolo basso continua a mostrare il terreno. L’eventuale passaggio inferiore dipende dalla proprietà fisica della scala sospesa, non dal PNG.

Questo documento fissa il contratto artistico e la sequenza di produzione; i nuovi PNG definitivi non sono ancora stati generati.
