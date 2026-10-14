# Roccia naturale e gradoni v1

Il manifest è usato da `client/render/rock-cliff-art.ts`. Le pareti vengono ricavate a runtime da rettangoli delle immagini sorgente e adattate ai contorni del terreno. Il corpo mantiene una scala costante; gradini e alzate vengono proiettati per quota e orientamento.

- `cliff-front-source.png`: originale invariato `C:/Users/tomma/Desktop/alture/Immagine ChatGPT 13 ott 2026, 00_57_30-3.png`.
- `cliff-weathered-source.png`: originale invariato `public/world-assets/montagna/Scogliera erbosa modulare sfaccettata.png`.
- `rock-steps-slab-atlas.png`: componenti ImageGen derivati dalle reference fornite; sfondo con alpha reale, nessuno scacchi incorporato.

Usare **Roccia naturale** come materiale pareti e **Scala** fra due piani adiacenti. La bozza **Prova · pareti rocciose e gradoni** contiene fronte, anello, L/T, terrazza, pilastro e scale nelle quattro direzioni. Gli asset dei ponti restano indipendenti.

Analisi completa delle 28 immagini, reference e prompt finale: `docs/rock-cliff-assets.md`.
