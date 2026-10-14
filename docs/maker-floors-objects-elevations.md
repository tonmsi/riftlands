# Pavimenti, oggetti e rialzi

Il World Maker distingue il piano calpestabile, gli elementi appoggiati al piano e la geometria delle alture. La categoria dei PNG si sceglie nell'inspector con **Categoria**, poi **Aggiorna asset**. Il filtro **Tipo di asset** mostra soltanto la categoria desiderata. Le miniature con **Auto** conservano il comportamento precedente finché non si assegna una categoria esplicita.

In **Costruisci**, le tre schede **Pavimenti / Oggetti / Rialzi** mostrano soltanto i controlli pertinenti e filtrano il catalogo. Scegliere un PNG seleziona la scheda coerente. **Pietra / sasso** è un oggetto; **Pavimento di pietra** è il materiale calpestabile `stone`. Le opzioni per scale e quote precise sono nei dettagli avanzati.

## Pavimenti

Un pavimento è piatto e calpestabile. Un PNG marcato **Pavimento** viene disegnato sul piano selezionato, anche sopra un rialzo o un ponte. Mantiene la quota e gli oggetti. Le vecchie maschere bloccanti o da nascondiglio del PNG non vengono usate.

Il pennello **Pavimenti** cambia il materiale e libera il blocco della superficie che dipinge, mantenendone l'altezza. L'acqua resta distinta e non percorribile. Il pennello sul ponte modifica il ponte, senza ridipingere il terreno sottostante.

## Oggetti

Gli oggetti si appoggiano al piano cliccato. I preset **Roccia base** e **Cespuglio base** piazzano oggetti separati; non trasformano il pavimento in roccia o bush. La roccia blocca la propria cella; il cespuglio è attraversabile e consente di nascondersi. È possibile piazzarli sopra un rialzo. Gli altri PNG usano le proprie maschere di collisione e visibilità.

Scale, rampe e ponti sono nella sezione **Oggetti → Strutture**, con i loro strumenti dedicati. Un PNG ornamentale di scala rimane grafica finché non si costruisce l'accesso con **Scala / rampa**: l'immagine da sola non crea un collegamento tra quote.

## Rialzi

Un PNG marcato **Rialzo** ha un'altezza assoluta, un materiale superiore e un materiale/kit PNG per le pareti. Disegnarlo crea superficie e pareti sulla sua griglia, aggiorna la quota degli oggetti già appoggiati al terreno e mantiene separati gli altri piani. Il PNG riveste la sommità, ritagliato entro la sua griglia; le pareti seguono la geometria del rialzo e il kit scelto. Non sostituisce gli oggetti con un muro piatto.

La quota predefinita è 3: ogni livello vale 16 unità e ogni tile è largo 48. I timbri ripetuti impostano questa quota, senza sommarla ogni volta. Per ripristinare la geometria usare **Rialzi → Ripristina terreno**; cancellare soltanto il rivestimento PNG conserva il terreno costruito. Le modifiche che intersecano ponti o invalidano scale esistenti vengono rifiutate.

## Scale come pareti inclinate

Una scala o rampa solida è un corpo inclinato con una superficie percorribile. Il personaggio sale lungo il collegamento; il corpo sottostante e i lati non sono attraversabili. Solo l'opzione esplicita **Scala sospesa** consente il passaggio sotto.

Il profilo **Parete inclinata continua** percorre tutta la distanza fra i centri delle due sponde. **Parete inclinata · 45°** richiede un dislivello di 3 livelli per ogni tile di corsa: ad esempio quota 0 → quota 3 fra due celle adiacenti. La corsa di un tile coinvolge la cella bassa e quella alta, e l'anteprima ne mostra l'ingombro. Il profilo con pianerottoli rimane disponibile e preserva le mappe precedenti.

Nella proiezione attuale una salita a 45° verso sud si comprime in una linea; l'editor richiede una scala più lunga in quella direzione. L'angolo effettivo viene mostrato nell'anteprima.

I PNG del kit si mettono in `public/terrain-walls/<nome-kit>/`. `front.png` è un modulo completo, `body.png` è il riempimento ripetibile, e `corner.png` fornisce i due angoli con riflessione per il lato destro. I nomi `corner-left.png` e `corner-right.png` hanno precedenza. I file `*-source.png` sono sorgenti e vengono esclusi dalla scansione. Vedi anche [wall-sprite-kits.md](wall-sprite-kits.md).
