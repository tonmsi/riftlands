# Terreni sfaccettati v1

Generati con ImageGen usando la scena approvata come riferimento. Collegati al renderer: erba, sentiero, acqua, roccia, sabbia, legno, fango, neve e ghiaccio. Ogni PNG è una texture piena, non un atlas di autotile. I bordi opposti vengono raccordati durante la creazione del pattern in memoria. Erba e sentiero ricevono una velatura climatica del 18%; gli altri conservano la palette originale. Roccia è un materiale di superficie, non uno sprite di scogliera: gli ostacoli mantengono la propria geometria. Pietra, mattoni e cespugli conservano gli asset precedenti.

Il mondo usa celle da 48 unità e pattern su 8 celle (384 unità). I raccordi vengono costruiti nel renderer. Aprire index.html per vedere materiali e ripetizione 2x2.

## Prompt

Revisione sparse: grass-sparse.png, path-sparse.png, mud-sparse.png e water-sparse.png sono le basi attive. Generate con ImageGen dalla scena approvata: singola texture quadrata ripetibile dall'alto, palette cartoon sfaccettata, campiture ampie a contrasto moderato, senza ciuffi, fiori, sassolini o rocce incorporati. Illuminazione uniforme, senza testo, margini o griglia. Le versioni originali restano conservate.

I ciuffi interni sono aggiunti nel renderer con probabilità variabile dal 2,5% al 14,5% per cella, modulata da un campo interpolato su aree di sei celle. Le posizioni e le forme sono determinate dalle coordinate e restano stabili durante spostamenti e ridisegni. I bordi hanno tre candidati per tratto, accettati nel 7–12% dei casi. Neve e ghiaccio non generano vegetazione o ninfee sui contatti con acqua, indipendentemente dalla temperatura della zona.

Per ciascun materiale: singola texture quadrata ripetibile, vista ortografica dall'alto, stile cartoon con campiture sfaccettate ampie, contrasto moderato, illuminazione uniforme, senza margini, griglie o testo. Palette e stile dalla scena approvata.

- grass: olive lime sage green grass ground, broad subtle polygon patches, very sparse tiny three-blade tufts, no bushes
- path: warm golden ochre dirt path ground, broad low contrast angular sand patches, sparse small flat pebbles, no grass
- sand: pale warm cream golden shoreline sand, broad subtle geometric color patches, almost no pebbles
- water: turquoise shallow river water, broad subdued angular cyan reflections, muted submerged blue green polygonal riverbed shapes, no shoreline, no foam border, no land
- rock: blue gray slate rock surface, large irregular faceted stone faces, restrained dark blue creases, pale warm gray lit facets, no cliff silhouette
- wood: warm orange brown wooden plank floor matching the dock, horizontal broad planks with subtle angular wood grain and restrained dark seams, no posts ropes or outer border
- mud: muted warm dark ochre brown damp earth, broad low contrast polygonal patches, sparse small dull stones, no puddles or grass
- snow: soft pale blue white snow ground, broad gentle polygonal shading, sparse rounded angular shallow depressions, no rocks or footprints
- ice: pale cyan blue frozen water ground, broad translucent angular facets and very sparse delicate cracks, no snow or shoreline
