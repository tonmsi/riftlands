# Direzione visiva del mondo

Palette derivata da e6bd6186, leggermente desaturata, e sponde arrotondate con
acqua bassa. Macchie pittoriche piatte e ampie, con contrasto moderato.
Il suolo usa quattro texture ripetibili da 1536 pixel, generate una sola volta,
ancorate alle coordinate del mondo e ritagliate per materiale: erba, sentiero, fango e pavimento dungeon neutro.
Ogni texture contiene 68 macchie, contro le 152 della revisione precedente. Le pennellate
vengono applicate dopo il fondo opaco con copertura allineata ai pixel.

Rocce e cespugli sono esclusivamente 1x1 o 2x2. Ogni blocco globale di 2x2
celle viene campionato quattro volte: si unisce solo se tutte e quattro le
celle contengono lo stesso oggetto; altrimenti si disegnano singoli 1x1.
Non ci sono ricerche di componenti connesse, forme allungate o gruppi verticali.
I 2x2 usano la stessa silhouette naturale scalata uniformemente.

L'acqua condivide una variante per maschera, senza pennellate per singola cella.
Le macchie ampie sono ancorate al mondo su una griglia da 192 unita: vengono
disegnate soltanto se tutta la loro superficie, con 16 unita di margine, rimane
nell'acqua. La validazione viene memorizzata in una cache da 512 candidati.
La minimappa usa i colori effettivi del terreno, le variazioni di umidita
dell'erba, tre verdi condivisi con i cespugli e i temi dei dungeon. Cache degli sprite limitata a 384 elementi
e 8 milioni di pixel. Nessuna cache di gruppi da svuotare e ricostruire.

Generazione procedurale, seed, collisioni, materiali e dungeon sono invariati.
Il test browser controlla anche che a vista ferma gli sprite non vengano
rigenerati e misura il solo tempo CPU di disegno del terreno (non gli FPS totali).

L'acqua ospita piccoli gruppi di ninfee deterministici soltanto nelle celle di
sponda. Gli angoli riparati hanno una probabilita maggiore e possono mostrare
due o tre foglie, talvolta con un fiore; l'acqua aperta resta libera. Sull'erba
compaiono radi ciuffi a tre fili e piccole pietre chiare e sfaccettate, prive di
contorno scuro. I sentieri hanno qualche pietra in piu, ma nessun dettaglio viene
aggiunto ai bordi dell'acqua o sopra gli ostacoli.

Le macchie nell'acqua sono piu frequenti e diffuse delle macchie terrestri, ma
usano colori molto trasparenti. Non contengono linee o onde e rimangono stabili
al passare del tempo. Gli angoli tra erba,
sentiero e fango vengono raccordati con curve da 13 unita, senza modificare le
celle usate da collisioni o navigazione.

I cespugli sono leggermente piu grandi e hanno un contorno continuo sottile per
separarsi dall'erba. Le rocce usano un contorno dello stesso peso visivo. Lo
spessore viene compensato rispetto alla scala, quindi resta identico sugli
oggetti 1x1 e 2x2. Una variante di cespuglio su quattro porta tre piccoli gruppi
di bacche con una luce pittorica. Le rocce dei dungeon passano dallo stesso
atlante e dallo stesso raggruppamento grafico delle rocce esterne.
La palette condivisa con la minimappa torna leggermente piu vivace, restando meno
satura della versione originale e6bd6186.
