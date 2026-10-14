# Piantine di riva

Sei PNG trasparenti a 192 × 192 pixel, con un ingombro visivo pensato per una casella da 48 unità. Sono esportati dai disegni Canvas del renderer del gioco, senza generazione AI.

- `ciuffo-erba-01.png`, `ciuffo-erba-02.png`: due ciuffi d’erba.
- `piantina-fiorita.png`: piccolo ciuffo con fiori.
- `canne-01.png`, `canne-02.png`: due gruppi di canne.
- `ninfee-01.png`: gruppo di ninfee con ombra e linea d’acqua.

Nel World Maker locale, **Asset e decorazioni → Sincronizza cartelle** aggiunge le immagini al gruppo **riva**. Seleziona un’immagine e usa lo strumento **Asset** per piazzarla. Le piantine distribuite automaticamente sulle rive continuano a essere disegnate dal renderer; questi PNG permettono il posizionamento manuale.

Fonte dei ciuffi e delle canne: `client/render/natural-terrain-edges.ts`. Fonte delle ninfee: `client/render/environment-art.ts`. Il piccolo script di esportazione della sessione è `.tmp/export-shore-assets.ts`.
