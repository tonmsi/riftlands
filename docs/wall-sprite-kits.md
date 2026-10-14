# Alture personalizzate con kit PNG

Le alture possono usare una famiglia di PNG riconosciuti dal nome, senza modificare il codice del renderer. Le immagini definiscono l’aspetto; quote, collisioni e accessi delle scale continuano a derivare dalla geometria della mappa.

## Cartelle e nomi

Metti ciascun kit in una cartella diretta sotto `public/terrain-walls`. Il nome della cartella identifica il kit salvato nella mappa; usa lettere minuscole, numeri e trattini. Per esempio:

```text
public/terrain-walls/wall-roccia/
  body.png
  front.png
  cap.png
  foot.png
  side-left.png
  side-right.png
  corner-left.png
  corner-right.png
  corner.png
  inner-corner-left.png
  inner-corner-right.png
  back.png
  kit.json
```

**Serve `body.png` oppure `front.png`.** Gli altri pezzi sono facoltativi e mantengono il disegno predefinito se assenti o se non si caricano. Non posare questi PNG come oggetti della mappa: il motore li sceglie in base ai bordi esposti e alle quote vicine. La libreria è separata da `world-assets`, così i pezzi della parete non entrano nell’elenco delle decorazioni.

| Nome | Utilizzo automatico |
|---|---|
| `body.png` | Corpo ripetibile della parete, per larghezza e altezza |
| `front.png` | Faccia frontale completa, adattata alla larghezza della cella e all’altezza effettiva della parete |
| `cap.png` | Labbro della sommità sul fronte, raccordato al profilo |
| `foot.png` | Piede della parete, sul bordo inferiore |
| `side-left.png`, `side-right.png` | Fianchi ovest/est, nella proiezione del gioco |
| `corner-left.png`, `corner-right.png` | Terminali esterni sinistro/destro; assenti nei giunti interni |
| `corner.png` | Terminale sinistro generico; viene specchiato per il terminale destro quando mancano le varianti direzionali |
| `inner-corner-left.png`, `inner-corner-right.png` | Raccordi delle rientranze, determinati dai vicini diagonali |
| `back.png` | Bordo posteriore, verso nord |

Sinistra e destra si riferiscono alla mappa vista dall’alto: ovest ed est. La faccia principale visibile è quella verso sud. La silhouette naturale rimane arrotondata; pietra, mattoni e legno conservano gli spigoli costruiti. Il kit viene ritagliato su queste sagome e in corrispondenza delle scale, senza chiudere gli accessi.

`front.png` resta utilizzabile anche quando esiste `body.png`: il corpo continua a riempire la parete e il fronte completo vi viene adattato sopra. Se manca `body.png`, il fronte fornisce anche il riempimento di base. Per gli angoli, `corner-left.png` e `corner-right.png` hanno precedenza sul generico `corner.png`, indipendentemente dall’ordine dei file nella cartella. Se manca soltanto una variante direzionale, il generico completa soltanto quella. Con un fronte completo, anche i terminali vengono adattati all’intera faccia; i kit precedenti che usano soltanto `body.png` conservano la ripetizione per fasce.

Puoi conservare nella stessa cartella immagini sorgenti come `cliff-front-source.png`. I file che terminano con **`-source.png`** sono esclusi dal catalogo e non generano avvisi: servono come materiale di lavoro, senza diventare componenti della parete.

Per personalizzare anche i gradini aggiungi:

```text
stairs-tread.png     # pedata
stairs-riser.png     # alzata
stairs-border.png    # pietra laterale
stairs-landing.png   # pianerottolo superiore
```

Le scale usano il kit del pianerottolo alto. I pezzi sono adattati alla direzione e alla larghezza del corridoio. Il pianerottolo basso continua a mostrare il terreno, senza piastrella aggiunta.

Il PNG non determina se si può passare sotto: le scale sono solide per default. **Scala sospesa · consenti passaggio sotto** abilita il percorso inferiore ed elimina il corpo minerale sotto i gradini, mantenendo le stesse parti del kit.

## Dimensioni e trasparenza

Per un primo kit, usa **48 px come larghezza nominale** e **16 px per una fascia di quota**: `body.png` può essere 48×16, oppure contenere più moduli ripetibili. Gli angoli e i fianchi condividono questa scala. `cap.png` e `foot.png` possono essere strisce da 48×4–8 px; le parti delle scale possono avere proporzioni diverse, perché vengono proiettate sul singolo gradino.

Il corpo si ripete: una parete più alta aggiunge fasce, senza stirare le pietre su tutta l’altezza. Il fronte completo invece viene adattato una volta per cella alla faccia visibile, così può includere erba, rocce e piede nello stesso PNG. I PNG degli angoli sono moduli di chiusura sovrapposti al corpo; usa trasparenza nelle parti che devono lasciare visibile il riempimento sottostante. Evita grandi margini trasparenti attorno ai moduli. Mantieni luce, palette e giunti coerenti fra i pezzi. Il renderer conserva un riempimento opaco sotto il corpo per evitare buchi involontari nella parete.

Il renderer prepara una copia in memoria alla scala del mondo per ciascuna parte. Anche le sorgenti grandi vengono campionate una sola volta; il file PNG originale resta invariato.

`tileSize` indica quanti pixel della sorgente rappresentano una cella da 48 px nel mondo. `levelHeight` indica quanti pixel della sorgente rappresentano una quota da 16 px. Senza configurazione valgono 48 e 16. Per un kit pixel art da 16 px basta impostare `tileSize: 16`: il valore predefinito di `levelHeight` diventa `16 / 3`, mantenendo la scala uniforme. Quindi un modulo nativo alto 16 px rappresenta tre quote, cioè 48 px di dislivello proiettato.

Sommità e piede sono ornamenti: la loro altezza segue la scala `48 / tileSize`. Corpo, fianchi e angoli seguono invece `16 / levelHeight`. Entrambi i valori accettano frazioni, per adattare sorgenti già disponibili senza modificarle.

Il fronte completo e i terminali usati insieme a `front.png` seguono la geometria della faccia invece della scala della texture di corpo. Possono quindi avere una risoluzione diversa da `body.png`, senza venire ridotti alla dimensione della sua texture. La larghezza logica resta una cella da 48 px; il dislivello continua a dipendere dalla quota della mappa. Cambiare PNG o risoluzione non modifica spazio occupato, collisioni o percorribilità delle scale.

## Configurazione facoltativa

`kit.json` è facoltativo. Esempio per PNG da 48 px:

```json
{
  "name": "Roccia scura",
  "material": "rock",
  "tileSize": 48,
  "levelHeight": 16,
  "pixelated": true
}
```

`name` è il nome mostrato nei menu. `material` sceglie la famiglia di parete (`earth`, `rock`, `stone`, `brick`, `wood`), con `rock` come predefinito. `pixelated: true` conserva i pixel netti; `false` usa il filtro adatto alle illustrazioni. Il materiale superiore del terreno rimane indipendente dal kit della parete.

## Uso negli editor e nel laboratorio

1. Copia i PNG nella cartella del kit e ricarica la pagina. Le cartelle vengono scoperte automaticamente: non serve sincronizzarle come decorazioni.
2. Nel World Maker scegli **Kit PNG delle pareti**, quindi usa **Dipingi livello**; nel Dungeon Maker scegli **Kit PNG delle pareti**, quindi **Imposta quota e materiali**.
3. Alzare o abbassare una superficie già decorata conserva il suo kit. Dipingere esplicitamente con **Predefinito** torna al disegno originale.
4. Per confrontare rapidamente i kit, usa **Kit parete** nel laboratorio `/surface-lab.html?scene=reference`. La scena di prova rimane separata dalla mappa installata. La sua esportazione conserva il kit scelto.

Nel kit `wall-roccia`, `body.png` è una copia invariata di `roccia-tile.png`, già presente nel progetto. La sorgente da 1254×1254 viene mappata a un modulo da 48×48 tramite il suo `kit.json`. I PNG di prova `front.png` e `corner.png`, da 381×409, forniscono la faccia completa e gli angoli specchiati: funzionano insieme alla texture di corpo esistente senza modificare i file. `cliff-front-source.png` rimane una sorgente esclusa dal catalogo. Se sostituisci soltanto `body.png` con un PNG da 48 px, aggiorna anche `tileSize` a 48 e `levelHeight` a 16.

Le mappe salvano `wallSkin` sulle celle interessate. Un kit assente su un altro computer ricade sul disegno predefinito, senza perdere geometria e movimento. Per condividere il risultato, includi anche la cartella dei PNG. `npm run build` scopre i kit e include catalogo e immagini in `dist`; dopo cambiamenti ai PNG della versione distribuita occorre ricostruire la build.

Gli editor segnalano nomi non riconosciuti, PNG incompleti e configurazioni errate. Un problema in un kit non nasconde le altre cartelle valide.

## Base rocciosa da una griglia 3×3

Il kit **Roccia · griglia 3×3** (`wall-roccia-grid`) contiene i nove ritagli della texture `cliff-grid.png` fornita. Sono disposti così:

```text
back-left.png    back.png    back-right.png
side-left.png   center.png   side-right.png
corner-left.png front.png   corner-right.png
```

L'opzione `layout: "grid-3x3"` conserva i ritagli originali sul disco e il loro allineamento orizzontale. I pezzi vengono posati all'esterno del piano rialzato, con circa 3 px di sovrapposizione sul terreno e 2 px nei giunti. Gli angoli nord sono distinti da quelli del fronte; anche gli angoli sud sporgono dalla cella, lasciando libera la superficie superiore.

La proiezione del fronte esclude il margine trasparente inferiore mediante una linea di piede comune ai tre pezzi sud, per portarli a terra senza disallineare gli angoli. Le bande laterali vengono riconosciute dalla parte principale della roccia, ignorando i piccoli frammenti sui tagli. La vecchia parete non viene disegnata sotto questo kit, mantenendo visibile la sagoma naturale dei PNG. Le aperture delle scale rimangono libere anche dove i pezzi delle celle vicine sporgono. `center.png` viene importato come riferimento trasparente e non riempie il terreno o la parete. Gli altri kit continuano a usare la disposizione descritta sopra.

I tagli originali sono documentati in `public/terrain-walls/wall-roccia-grid/grid.json`; `scripts/import-cliff-grid.ps1` li rigenera senza ridimensionare l'illustrazione. Le differenze di un pixel fra i ritagli dipendono dalla sorgente 1186×1183, non divisibile per tre. Per provarlo apri `/surface-lab.html?scene=reference&wallSkin=wall-roccia-grid` oppure selezionalo dal menu **Kit PNG delle pareti** degli editor.
