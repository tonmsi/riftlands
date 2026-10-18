# Quote, terreni sopraelevati e scale

Implementazione sul branch `codex/livelli-terreno-scale`, creato da
`codex/prove-grafica` al commit `1b91457`.

## Regole

- `elevation` è una quota intera da -128 a 127. `Actor.level` resta la progressione.
- Terra procedurale a 0, acqua a -1. L'acqua conserva il blocco del movimento;
  non viene aggiunta una meccanica di nuoto o immersione.
- Il PG sale e scende soltanto tramite una **Scala**. Un bordo senza collegamento
  blocca il movimento, senza diventare automaticamente un muro per i colpi.
- I proiettili mantengono la quota di lancio, anche se il proprietario cambia piano,
  e colpiscono soltanto PG/NPC alla stessa quota.
- Rocce e vecchie celle bloccanti hanno ingombro +1 rispetto alla base.
  I solidi occupano intervalli `[base, top)`: un ostacolo 0→1 blocca a quota 0;
  un colpo a 1 lo supera. Una parete 0→14 blocca i colpi da 0 a 13.
- Le superfici possono sovrapporsi in XY a quote diverse. La stessa casella può
  ospitare terreno a 0 e ponte a 1. Le superfici sovrapposte alla stessa quota
  vengono segnalate dalla validazione.
- Senza forme specifiche valgono i tile interi. Le forme rettangolari consentono
  bordi e collisioni parziali; le quote restano intere anche con coordinate frazionarie.

Un ponte è una superficie sospesa, senza massa piena sottostante. Questo permette
il passaggio sotto a quota 0 anche con un ponte a 1. Pilastri e parapetti vanno
definiti come ostacoli separati. Nel modello discreto l'impalcato sottile non occupa
un intero piano di tiro: assegnargli il solido 0→1 bloccherebbe il sottopassaggio.

## World Maker

Per creare un terreno sopraelevato:

1. A sinistra, in **Costruisci → Terreno**, scegli Erba, Strada, Neve o un altro materiale.
2. Nel pannello destro imposta **Quota del terreno**, per esempio 1, 2 o 14.
   Lascia vuoto, o premi **Mantieni quota del terreno**, per cambiare soltanto materiale
   alla quota già presente sotto il pennello. Terra e acqua conservano le rispettive
   quote predefinite 0 e -1 quando dipingi sul terreno base.
3. Dipingi direttamente sulla mappa. Non serve selezionare o disegnare prima un'area.
   Per una singola casella imposta **Raggio pennello 0**. I rialzi generano il bordo
   esterno `cliff-grid`, largo un tile: una casella isolata ne ha otto attorno.
   Le caselle adiacenti alla stessa quota condividono il bordo anche se hanno materiali
   diversi. Il bordo occupa il piano inferiore, blocca il movimento e i colpi sotto
   la sommità; i colpi alla quota superiore lo superano. **Procedurale** rimuove
   anche la quota dipinta e rigenera i bordi delle parti rimaste.
4. **Crea una scala di accesso al rialzo**, facoltativo e disattivato di default, aggiunge una
   scala in pietra per ogni rialzo connesso privo di accessi, se ci sono due estremità
   libere e un corridoio percorribile. Cambiare materiale non duplica la scala.
   Per più accessi o una scala larga più tile, premi **Scala / passaggio · sali e scendi** a
   sinistra oppure **Disegna scala / passaggio** a destra. Imposta le due quote
   e l'asse, poi trascina il collegamento. Puoi anche selezionare l'area e premere
   **Aggiungi scala di accesso** per precompilare le quote.
   La larghezza minima è **1 tile intero (48 unità)**. Il campo **Larghezza scala · tile**
   permette 2, 3 o più tile; funziona anche selezionando una scala esistente e premendo
   **Aggiorna selezione**. Le scale nuove si agganciano a celle intere; la lunghezza
   include i pianerottoli. La scala automatica usa un tile di larghezza e tre tile
   di lunghezza: pianerottolo superiore, bordo attraversabile, pianerottolo inferiore.
5. **Applica al gioco** salva il progetto; fino a quel momento lavori sulla bozza.

Il collegamento fra due quote non richiede una scala disegnata. Nel pannello destro,
**Grafica del collegamento → Passaggio · conserva terreno / PNG** lascia visibile
il terreno esistente; **Scala in pietra** aggiunge il disegno dei gradini.
Per usare un'immagine del catalogo, selezionala e premi **Usa questo asset come
scala / passaggio**. Viene creato un collegamento sull'ingombro dell'asset, senza
sovrapporre altri PNG. Configura le due quote relative e la direzione, premi
**Aggiorna selezione**, quindi piazza l'asset normalmente: ogni istanza eredita il
passaggio. Le due metà dell'immagine appartengono alle quote indicate. Puoi
allargare l'area del passaggio con le dimensioni della selezione; per coprirla
graficamente regola anche le dimensioni dell'asset.

Non occorre creare prima un livello separato nell'editor. Le superfici dipinte sono
compattate in segmenti orizzontali; i bordi vengono calcolati localmente e non aggiungono
otto asset per ciascun tile al JSON. Mare e transizioni del terreno base conservano
il rendering esistente. I rialzi rettangolari, i ponti e le collisioni personalizzate
restano disponibili in **Ponti, scale e forme avanzate**.
Il rialzo dipinto conserva lo stesso colore e le stesse texture del terreno normale:
la quota non aggiunge una tinta scura. Le annotazioni colorate riempiono le aree
solo attivando **Collisioni / visibilità**.
I lati dritti usano i tile centrali completi di `cliff-grid`; gli angoli esterni
usano i quattro tile d'angolo. I raccordi bassi rientranti usano i file dedicati
`cliff-grid-90corner-180.png` (a sinistra) e `cliff-grid-90corner-270.png` (a destra).
La grafica del bordo viene rimossa nel corridoio delle scale, anche
quando il gioco disegna separatamente i due piani. Il terreno conserva una collisione
esterna di un tile, senza aggiungere gradini attraversabili fuori dalle scale.

Nel pannello destro **Bordi automatici · cliff-grid**, scegli un pezzo e premi
**Modifica immagine e collisioni**. Si apre il normale pannello Asset: modifica le
celle **Bloccante/Calpestabile**, **Nascondiglio**, **Trasparente** o **Nascondiglio +
trasparenza**, oltre a opacità e sfumatura. **Sfondo** disegna il bordo dietro ai PG
sul piano inferiore; **Oggetto** lo disegna al piano superiore e può coprire i PG sotto.
La stessa definizione compare nel catalogo ed è condivisa da tutti i bordi di quel
tipo, senza trasformare i bordi in copie piazzate manualmente.

Ogni bordo automatico resta grande un tile del mondo. **Suddivisione di ogni tile**
permette di dividerlo in 2×2, 4×4 o 8×8 sottocelle senza ingrandire l'immagine.
Questo controllo è disponibile per tutti i PNG/SVG, indipendentemente da larghezza,
altezza e scala del disegno.
Con **Piano delle sottocelle che dipingi**, scegli **0**, **+1**, **−1** o una quota
relativa personalizzata, quindi dipingi i quadratini interessati. Nei cliff-grid
la base è il terreno inferiore: **Calpestabile +1** estende il pavimento superiore
solo nelle sottocelle dipinte, mentre le altre possono restare bloccanti.
Negli asset normali la quota si somma alla base del piazzamento. **Mantieni quota
esistente** cambia solo collisioni e visibilità; **Rimuovi quota personalizzata**
ripristina il comportamento precedente. Senza quota personalizzata, le celle
bloccanti del bordo occupano l'intervallo tra base e sommità e quelle calpestabili
liberano il terreno inferiore. Cambiare piano richiede un collegamento configurato
come scala o passaggio, che può usare qualsiasi PNG o il terreno esistente.
Le quote personalizzate valgono anche per collisioni dei colpi, nascondigli e filtro
dei livelli. Non si possono riunire sottocelle con quote diverse riducendo la griglia:
prima occorre uniformarne le quote.
Le impostazioni sono salvate, esportate e ripristinate col mondo.

Il pannello destro **Terreni e quote** è disponibile anche all'apertura, quando
non è selezionato un oggetto. Scegli **Sulla mappa** per quote assolute, oppure
**Dentro un oggetto** per quote relative. Gli strumenti e il filtro dei livelli
rimangono a sinistra; parametri, istruzioni, materiale e proprietà sono a destra.

Il normale strumento **Seleziona** riconosce anche i terreni e le scale. In alternativa
usa **Seleziona forma** o l'elenco **Area selezionata** nel pannello destro.
**Aggiorna selezione** modifica posizione, dimensioni, materiale e quote;
**Elimina forma** rimuove anche la massa collegata a un rialzo.
L'aggancio è a ¼ di tile e i campi numerici permettono correzioni più fini.

| Strumento | Risultato |
|---|---|
| Rialzo | Superficie alla quota attiva e massa da Base alla quota attiva |
| Passaggio sospeso | Superficie con terreno sottostante conservato |
| Superficie | Area calpestabile senza massa automatica |
| Ostacolo | Rettangolo solido tra Base inclusa e Sommità esclusa |
| Scala | Corridoio bidirezionale tra Quota A e Quota B |

Le scale seguono X da sinistra a destra oppure Y dall'alto verso il basso;
invertire A e B inverte salita e discesa. La quota cambia sulla linea centrale.
La larghezza deve consentire il passaggio dell'intero ingombro del PG.
Il corridoio ritaglia la massa collegata ai rialzi; non attraversa automaticamente
rocce, pilastri o muri indipendenti. La validazione verifica le due estremità.

**Livelli visibili** filtra terreno, superfici, immagini degli oggetti, NPC,
spawn, passaggi e annotazioni. In **Costruisci → Terreni e quote → Livelli visibili**
scegli direttamente **Solo quota 0 · terra**, **Solo quota 1** oppure **Tutti · vista completa**.
Il menu include anche le altre quote presenti. Si possono isolare inoltre
la quota attiva, tutte le quote da un valore in su, un intervallo inclusivo oppure
quote separate (per esempio `-1, 0, 2, 14`), anche attraverso le caselle di selezione.
La quota attiva è distinta dalla visibilità; passando a una selezione che non la
comprende viene scelta la prima quota visibile. Una selezione vuota nasconde tutto.

Le quote escluse scompaiono, senza essere mostrate in trasparenza. Un rialzo
nascosto lascia un vuoto nel piano sottostante che sostituisce; un ponte nascosto
lascia visibile il terreno sotto, se quel livello è selezionato. Negli oggetti
con superfici multiple il filtro ritaglia le regioni dell'immagine in base alle
quote relative. Griglia e cursore restano strumenti dell'editor, disattivabili
se si desidera una vista pulita. Il filtro non modifica i dati della mappa.

Superfici verdi, solidi arancioni e scale gialle mostrano quote e direzione durante
l'uso degli strumenti avanzati o attivando **Collisioni / visibilità**. Il pennello
Terreno modifica anche materiale e quota dei rialzi esistenti.

## Asset spostati e importazione

World Studio ripara automaticamente all'apertura, prima dell'export e all'applicazione
i percorsi spostati che corrispondono a un unico nome file. ID, maschere, geometria e
piazzamenti restano associati allo stesso asset. Nomi duplicati in cartelle diverse
non vengono indovinati. **Sincronizza cartelle** scopre anche i nuovi file; non è
necessario sincronizzare per riparare uno spostamento univoco.

L'export JSON contiene documento, immagini e musica in base64, quindi può superare
50 MB. L'importazione accetta archivi fino a **512 MB**, leggendo il file localmente
e ripristinando separatamente le risorse; immagini condivise vengono importate una
volta sola. Restano validi i limiti delle singole immagini e delle tracce musicali.
Vengono ripristinate le immagini elencate nel catalogo dell'archivio, anche se non
piazzate sulla mappa, senza ricopiare o cancellare l'intera cartella `world-assets`.
Un file identico viene riutilizzato; un'immagine diversa con lo stesso nome riceve
un suffisso stabile derivato dal contenuto. I riferimenti del mondo importato
usano il percorso restituito, conservando ID, maschere e piazzamenti.

I piazzamenti asset e gli NPC hanno una quota nell'ispettore; i nuovi piazzamenti
usano la quota attiva. Anche lo strumento Spawn la conserva. Gli asset possono
essere sovrapposti su basi diverse e la selezione sulla mappa rispetta la quota.

Gli oggetti conservano geometria locale e quote relative alla propria base:
superficie +1 e scala 0→1, su un'istanza con base 5, diventano superficie 6 e
scala 5→6. Spostare l'oggetto sposta tutte le forme. La geometria esplicita
sostituisce le vecchie celle di collisione dell'asset; visibilità e trasparenza
restano indipendenti. **Ripristina collisioni a celle** rimuove la geometria esplicita.

Undo/redo, IndexedDB, import/export e Applica al gioco conservano i nuovi dati.
I punti dei passaggi tra mappe hanno quote di ingresso e arrivo proprie.
I vecchi documenti restano caricabili senza riscrittura obbligatoria.

## Runtime e rendering

`shared/elevation.ts` definisce forme e intervalli; `shared/world-elevation.ts`
indicizza le regioni e risolve supporto, solidi e transizioni. I dati sono sparsi:
non viene creata una griglia per ogni sottocella del mondo o per ogni quota.

Server e predizione client condividono il movimento e riconciliano insieme XY,
quota e superficie. Il controllo di supporto considera l'intero cerchio del PG,
anche fra rettangoli adiacenti. Gli impatti dei proiettili usano il segmento completo.
Corpi, autoaim, attacchi locali, trappole, raccolta e dialoghi rispettano la quota.
Spawn, respawn, salvataggio, riconnessione e passaggi tra mappe conservano o
risolvono una superficie valida. Non viene accettata una quota dagli input client.

Il rendering procede per quota e poi per profondità Y. Le regioni di superficie
degli asset vengono ritagliate dall'immagine e disegnate al proprio piano, fra chi
passa sotto e chi sta sopra. La regione che copre il PG locale diventa trasparente.
Il numero di quota non sposta automaticamente lo sprite sullo schermo.

Le forme sono rettangolari. Per immagini con ringhiere o parti che devono coprire
il PG sul piano superiore usare asset separati con pivot appropriato. Non viene
aggiunto un editor generale di poligoni o di ritagli grafici indipendenti.
Gli NPC conservano il comportamento di navigazione esistente e i controlli di
quota: questa modifica non introduce un pathfinder globale fra tutte le scale.

## Verifiche

`tests/elevation.test.ts` copre quote negative, livelli 0/1/14, bordi nei due versi,
scale, supporto circolare, maschere parziali, rocce, ponti con un solo livello di
differenza, asset relativi, rete, riconciliazione, riconnessione, combattimento e warp.
`tests/integration/elevation-browser.test.ts` verifica authoring, undo/redo,
applicazione del documento e ordine di disegno sotto/sopra un ponte.

Comandi: `npm test`, `npm run build`, test browser mirati. I server temporanei
vengono avviati soltanto durante i test e chiusi nei rispettivi blocchi di pulizia.
