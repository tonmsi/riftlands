# Roccia · griglia 3×3

Nove ritagli della texture `cliff-grid.png` fornita, con trasparenza, posizione dei pixel e profilo colore ICC conservati. La sorgente da 1186×1183 px non è divisibile per tre: i tagli sono a x=395/791 e y=394/789. I pezzi differiscono di un pixel; nessuno viene ridimensionato durante l'importazione. `grid.json` registra tutti i rettangoli.

| Alto sinistra | Alto centro | Alto destra |
|---|---|---|
| `back-left.png` | `back.png` | `back-right.png` |
| `side-left.png` | `center.png` | `side-right.png` |
| `corner-left.png` | `front.png` | `corner-right.png` |

`layout: "grid-3x3"` in `kit.json` mantiene l'allineamento orizzontale dei ritagli. Il renderer sceglie i pezzi in base ai bordi esposti e li posa all'esterno del piano rialzato, con circa 3 px di sovrapposizione sul terreno. Anche gli angoli frontali hanno spazio fuori dalla cella; i pezzi diritti completano i raccordi con una sovrapposizione di 2 px.

Il margine trasparente inferiore dei tre moduli sud viene escluso durante la proiezione usando una linea di piede comune, così la roccia arriva alla quota del terreno basso. I PNG restano invariati. Il centro, quasi interamente trasparente nella sorgente, non viene dipinto e non sostituisce il materiale del terreno. Il fronte fornisce la componente obbligatoria del kit; non serve un corpo opaco aggiuntivo.

Quando questo kit è caricato, la precedente parete rocciosa non viene dipinta sotto i PNG: il contorno naturale rimane visibile. Quote e collisioni continuano a usare la geometria della mappa. Le aperture delle scale vengono sottratte anche ai moduli sporgenti delle celle vicine; scale e ponti mantengono i propri asset.

Nel World Maker e nel Dungeon Maker scegli **Kit PNG delle pareti → Roccia · griglia 3×3**, quindi dipingi una quota. Nel laboratorio apri `/surface-lab.html?scene=reference&wallSkin=wall-roccia-grid`.

Per rigenerare gli stessi asset dalla sorgente nel repository, esegui da PowerShell:

```powershell
./scripts/import-cliff-grid.ps1 -Source ./public/terrain-walls/wall-roccia-grid/cliff-grid-source.png
```

Il file `cliff-grid-source.png` è materiale di lavoro e rimane escluso dal catalogo dei componenti. Il kit precedente `wall-roccia` è disponibile separatamente.
