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

Gli asset iniziano a caricarsi durante il login, anche quando la sessione è già attiva. La barra conta le risorse completate (non i byte); l'ingresso in partita aspetta sprite, ritratti e PNG configurati. Le immagini vengono decodificate prima dell'uso, con tre download simultanei. Se un'immagine fallisce o non risponde entro 60 secondi, si usa lo stile predefinito senza bloccare l'ingresso. Il login può essere completato mentre le immagini si caricano.

La modifica del manifest viene letta al prossimo caricamento della pagina. Dopo una build, i PNG e il manifest vengono copiati in `dist/home`.
