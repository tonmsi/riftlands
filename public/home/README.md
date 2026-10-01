# Immagini della homepage

Metti qui i tuoi PNG e aggiorna `assets.json`. I percorsi iniziano con `/home/`.
Un valore `null` mantiene lo stile predefinito, senza richiedere file mancanti.

```json
{
  "logo": "/home/logo.png",
  "loginBackground": "/home/login.png",
  "selectionBackground": "/home/selezione.png",
  "classes": {
    "paladin": { "portrait": "/home/paladino.png", "background": "/home/paladino-sfondo.png" },
    "warrior": { "portrait": "/home/guerriero.png", "background": "/home/guerriero-sfondo.png" },
    "mage": { "portrait": "/home/mago.png", "background": "/home/mago-sfondo.png" },
    "hunter": { "portrait": null, "background": null }
  }
}
```

- `logo`: PNG trasparente, sostituisce il nome e il simbolo nell'intestazione.
- `loginBackground`: immagine generica per login e registrazione.
- `selectionBackground`: sfondo neutro facoltativo per la scelta del campione.
- `portrait`: illustrazione del campione centrale; meglio un PNG trasparente verticale.
- `background`: sfondo della classe per ingresso nel mondo, statistiche, classifiche, achievement e impostazioni.

Gli sfondi riempiono la schermata e possono essere ritagliati: lascia i dettagli importanti al centro. Le illustrazioni del personaggio e il logo mantengono le proporzioni.

All'apertura e al refresh appare una schermata neutra di caricamento. Logo, menu e sfondi vengono mostrati insieme soltanto dopo la decodifica di sprite, ritratti e PNG configurati, anche quando la sessione è già attiva. La barra conta le risorse completate (non i byte), con tre download simultanei. Se un'immagine fallisce o non risponde entro 60 secondi, si usa lo stile predefinito come risultato finale, senza mostrare prima un fallback provvisorio.

La cornice della home e lo sfondo mantengono le dimensioni del viewport. Il contenuto scorre dentro il menu: il passaggio tra statistiche, classifiche, achievement e amici non cambia la scala dello sfondo né la larghezza della schermata.

La modifica del manifest viene letta al prossimo caricamento della pagina. Dopo una build, i PNG e il manifest vengono copiati in `dist/home`.
