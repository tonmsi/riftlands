# Dungeon maker

Apri `/dungeon-maker.html` o **Dungeon maker** nel menu. Nessun login o WebSocket: l'editor salva una bozza nel browser e non modifica il mondo in esecuzione. Esporta le bozze per conservarle e trasferirle.

## Authoring

- Mappe 8×8–96×96; caselle da 48 unità. Terreno: erba, pavimento, muro, acqua, cespuglio, fango.
- Tutti gli NPC attuali: gelatina, fuoco fatuo, guardiano; livello individuale. Tutti i boss del catalogo sono selezionabili, anche più copie dello stesso modello.
- Boss futuri come segnaposto con nome, posizione e raggio; nessuna logica di combattimento richiesta per salvare la bozza.
- Incontri: nome e regione rettangolare, modificabile dall'ispettore e visibile sulla mappa. Assegna ogni boss, ingresso e barriera al suo incontro.
- Più boss nello **stesso incontro** condividono preparazione, partecipanti e fiamme: vittoria quando tutti sono morti. Oro e XP vengono assegnati solo al completamento; un wipe ripristina anche i boss già uccisi. Il respawn comune usa la durata massima dei boss.
- **Incontri separati** nella stessa mappa hanno regioni senza sovrapposizioni, ciascuna con boss, 1–5 ingressi e fiamme propri. Puoi combinare incontri singoli e multipli.
- Fiamme con posizione iniziale, lunghezza in caselle e orientamento. Seguono la meccanica esistente: durante il fight il contatto uccide i partecipanti; non sono un muro che arresta il movimento. Uscire dalla regione del fight è anch'esso letale.
- Selezione, trascinamento, cancellazione, pennello continuo, zoom, pan con tasto destro, undo/redo (50 modifiche), Ctrl/Cmd+Z.
- Controlli di terreno, ingombro, regioni, sovrapposizioni e raggiungibilità. Anteprima del movimento con collisioni e fango; non simula il combattimento.

Le bozze incomplete possono essere salvate. La compilazione richiede posizioni valide. Copiare un dungeon dal catalogo mantiene boss e fiamme, aggancia le posizioni alla griglia e approssima le regioni con rettangoli: controllare la copia prima di usarla.

## Dove mettere il dungeon

1. Crea terreno, boss, NPC, incontri, ingressi e fiamme. Apri almeno una casella sul bordo per l'accesso dal mondo.
2. Imposta un ID nuovo e l'origine X/Y in caselle: sono le coordinate reali nel mondo condiviso. Il maker non crea un'istanza privata.
3. **Esporta bozza** e conserva il file in `content/dungeons/nome.draft.json` (o un altro percorso a scelta).
4. Dalla cartella del progetto esegui:

   ```sh
   npm run dungeon:import -- content/dungeons/nome.draft.json
   npm run build
   ```

5. Riavvia il server con la nuova build. Per un server remoto distribuisci anche `shared/custom-dungeons.json` e la build client insieme al codice server aggiornato.

Il comando valida il file, collega ogni boss al comportamento scelto e scrive il catalogo condiviso `shared/custom-dungeons.json`. Client e server caricano la stessa geometria e gli stessi ID. Genera un breve accesso esterno verso l'apertura e un punto di espulsione fuori dalla mappa. I segnaposto senza un modello implementato bloccano l'installazione, ma si possono salvare ed esportare nell'editor.

L'importazione rifiuta ID già installati e mappe troppo vicine/sovrapposte. Non sostituisce automaticamente dungeon esistenti: modificare gli ID o le regioni di un dungeon già giocato richiede anche una migrazione dello stato persistente dei boss. Il comando non modifica gli account. Conserva la bozza originale per iterare.

**Esporta mappa runtime** serve per ispezionare geometria e collegamenti compilati; il comando di installazione riceve la **bozza**, non quel file.

## Limiti ancora presenti

Regioni rettangolari condivise tra trigger, ammissione, combattimento, aggro e leash; non ancora poligoni distinti disegnabili. Mancano playtest AI nell'editor, libreria multiprogetto, aggiornamento/migrazione guidata dei dungeon installati e pubblicazione amministrativa protetta. Il database non è necessario per questo flusso.
