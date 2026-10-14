# Roccia PNG · esempio

`body.png` è una copia invariata di `public/world-assets/montagna/roccia-tile.png`, già presente nel progetto. Questo esempio sostituisce solo il corpo; gli altri componenti conservano il disegno predefinito.

La sorgente è un modulo da 1254×1254 px, mappato a 48×48 px nel mondo. Per sostituirlo con tile da 48 px, imposta `tileSize: 48` e `levelHeight: 16` in `kit.json`. Per tile da 16 px usa `tileSize: 16` e ometti `levelHeight`: viene calcolato automaticamente come `tileSize / 3`.

Aggiungi liberamente `cap.png`, `foot.png`, `corner-left.png`, `corner-right.png`, `inner-corner-left.png`, `inner-corner-right.png`, `side-left.png`, `side-right.png` e `back.png`. Le parti facoltative delle scale sono `stairs-tread.png`, `stairs-riser.png`, `stairs-border.png`, `stairs-landing.png`. I nomi sono minuscoli e le immagini devono essere PNG autentici.

Le istruzioni complete sono in `docs/wall-sprite-kits.md`. Ricarica la pagina dopo aver aggiunto o cambiato i PNG. Negli editor scegli **Kit PNG → Roccia PNG · esempio** e usa **Dipingi livello / Imposta quota e materiali** sulle alture.
