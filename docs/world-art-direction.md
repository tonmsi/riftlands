# Direzione visiva del mondo

Lo scenario usa verdi salvia, acqua blu ardesia e terra sabbia desaturata.
Luci, saturazione e dettagli più evidenti restano disponibili per personaggi,
pickup e combattimento. Le rocce mantengono una silhouette distinta perché sono
ostacoli; vegetazione e acqua hanno un trattamento più quieto.

Le coste raccordano i quattro lati e i quattro vicini diagonali, anche oltre i
chunk: curve convesse sulle punte e concave nelle rientranze. La fascia sabbiosa
rimane all'interno delle celle d'acqua non attraversabili: è parte della sponda,
non un nuovo percorso. Collisioni e linea di vista conservano la griglia condivisa.
I riflessi compaiono solo in una minoranza delle celle d'acqua interne.

Il generatore usa bacini più ampi leggermente deformati e raggruppa rocce e
cespugli, riducendo gli ostacoli isolati. Strade e accessi curati restano prioritari.
Il seed è invariato ma il terreno naturale generato cambia: eventuali posizioni
salvate lontano dagli accessi possono trovarsi in un terreno diverso. Il controllo
già presente al login riporta allo spawn chi si trova dentro un ostacolo.

## Fondamento e limiti

- [Chuquichambi et al., 2022](https://pubmed.ncbi.nlm.nih.gov/36285721/):
  la meta-analisi rileva una preferenza media per le curve, con variabilità tra
  contesti. Motiva i raccordi, non una regola universale per tutti gli oggetti.
- [Reber, Schwarz e Winkielman, 2004](https://psy2.ucsd.edu/~pwinkiel/reber-schwarz-winkielman-beauty-PSPR-2004.pdf):
  la processing fluency è una cornice teorica per leggibilità e risposta estetica.

Palette, densità e spessori sono scelte progettuali ispirate a questi principi,
non valori validati sperimentalmente per Riftlands. Nessuna promessa di aumento
della retention: servirebbe un confronto controllato con giocatori.
