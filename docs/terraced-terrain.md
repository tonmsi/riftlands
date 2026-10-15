# Sopraelevazioni a fasce di tile

Nel World Maker, **Geometria rialzo → Fasce di 1 tile per livello** costruisce pareti che occupano celle reali, usando la griglia esistente da 48 px. La sagoma dipinta comprende pareti e sommità: ogni salto di quota riserva una fascia interna di una cella. Un rialzo a quota 1 ha un anello di pareti; a quota 2 ne ha due, poi comincia la superficie percorribile. Una sagoma troppo stretta può essere composta soltanto da pareti: allargarla lascia spazio alla sommità.

Il pennello **Dipingi livello** applica la geometria scelta anche alle sopraelevazioni precedenti. Le mappe già salvate conservano il loro layout finché non viene scelto quello nuovo. La proiezione grafica rimane di 16 px per livello: questa misura solleva il disegno, mentre la fascia occupata nel mondo misura sempre un tile intero. Non viene introdotta geometria 3D.

`/surface-lab.html?scene=terraced` apre una scena giocabile con il renderer e il movimento del gioco. Tieni D o la freccia destra per salire la scala iniziale; **Tre rialzi consecutivi** mostra le quote 1, 2 e 3 separate da superfici percorribili. **Scala da sud** permette di provare l’accesso opposto. La mappa è scaricabile e rimane separata dal mondo installato.

## Scale integrate

Seleziona **Scala / rampa**, con profilo **Incassata nelle fasce del terreno**, e clicca il piano inferiore e quello superiore lungo una direzione cardinale. L’editor allinea automaticamente gli accessi ai lati delle fasce, anche se i clic sono più lontani dal bordo. Per un salto di N quote servono N celle di parete fra i pianerottoli: la distanza fra i loro centri è N+1 celle. La scala riusa le fasce esistenti e apre soltanto la propria corsia; le pareti ai lati rimangono solide. I due accessi devono essere percorribili e le fasce attraversate devono salire in ordine.

Il disegno dei gradini termina al bordo della sommità: la cella di accesso superiore conserva il proprio terreno, senza una pedana sovrapposta. Una scala a tre quote larga una corsia attraversa 3 × 1 tile di parete e interessa 5 celle includendo i due accessi.

Durante la camminata, un approccio vicino alla bocca della scala viene allineato alla corsia usando lo spazio del pianerottolo. Funziona in salita e discesa: non allarga il passaggio, non attraversa ostacoli e si annulla con un comando laterale esplicito.

Nord, est, sud e ovest usano la stessa geometria e gli stessi controlli. Le larghezze disponibili sono una, due o tre corsie. Per rialzi separati da superfici pianeggianti si costruisce una scala per ciascun tratto di parete. I profili continui e con pianerottoli precedenti restano disponibili per le strutture già esistenti, comprese le scale sospese.

**Rimuovi accesso** elimina supporti e collegamenti della scala: le fasce originali tornano visibili e bloccanti. Una modifica di quota che interessa la struttura rimuove i suoi supporti nella stessa operazione annullabile. Undo/redo ricostruisce terreno, pareti e accessi dai dati del documento.

## Architettura e salvataggi

`surfaceCells[].layout: 'terraced'` identifica il nuovo terreno; l'assenza conserva il comportamento storico. Il campo `elevation` salvato è la quota richiesta dal pennello. `deriveTerracedTerrain` calcola la quota effettiva delle fasce, limitando la differenza fra celle adiacenti a un livello; ogni cella più alta di un vicino è una parete. L'indice conserva sia le celle originali (`authoredAt`) sia quelle risolte (`at`, `atColumn`). `terrainRole`, `wallMask` e `logicalElevation` sono risultati derivati, non una seconda mappa persistita.

Il movimento, la navigazione e i raggi consultano le celle risolte. Una parete è bloccante anche quando la sua quota coincide con quella del personaggio; gli asset pavimento non possono renderla percorribile. `surfaceStairs[].profile: 'terraced'` riusa descrittore, supporti `stair:<id>` e collegamenti adiacenti già presenti. Il corridoio attraversabile appartiene alla scala, mentre il terreno sottostante mantiene la sua parete. Non è ammesso un sottopasso per una scala incassata.

Il renderer usa lo stesso indice, riveste l'intera fascia con gli asset parete e interrompe tutte le fasce attraversate dalla scala. I PNG della sommità vengono ritagliati alle superfici superiori, così non coprono pareti o gradini. Quote, materiali e collisioni restano indipendenti dalle immagini.

Il bordo nord usa una roccia schiacciata in prospettiva e illuminata come un versante visto dall’alto; il fronte sud conserva il corpo più scuro e verticale. I raccordi agli angoli seguono le adiacenze. Questa differenza grafica mantiene inalterati la fascia fisica da un tile e i supporti percorribili.

I parser di mondo e dungeon conservano i nuovi campi. Compattazione RLE, esportazione, importazione e ricollocazione mantengono le quote logiche e ricostruiscono le fasce. Le mappe senza `layout` e le scale senza il nuovo profilo conservano la geometria precedente.
