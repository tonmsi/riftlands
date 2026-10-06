# Catalogo boss e laboratorio visuale

Avvia `npm run world:studio` e apri **Contenuti → Boss · laboratorio visuale**.
L’anteprima usa lo stesso `ActorSpriteRenderer` del gioco: terreno verde,
ombra, hitbox e croce della posizione dell’attore nel mondo.

Puoi regolare larghezza dello sprite, anchor normalizzato (0–1), offset,
ombra, spritesheet, griglia, direzione, durata e ripetizione delle animazioni.
Trascinare sullo sprite imposta l’anchor; un’animazione può avere un anchor
e un offset propri. La hitbox è un raggio di collisione indipendente dalla
dimensione dell’immagine. L’editor permette anche di regolare vita, velocità,
livello, respawn, gold e parametri degli attacchi già disponibili.

**Nuovo da questo** duplica boss e skin con un nuovo ID. Puoi scegliere gli
spritesheet in `public/actor-assets` e `public/world-assets` oppure importare
un PNG/SVG. L’importazione usa gli stessi controlli degli asset del mondo.
Per le animazioni direzionali servono quattro righe; la dimensione dei frame
viene ricavata dall’immagine e deve essere compatibile con righe e colonne.

**Salva catalogo boss** aggiorna `shared/actor-catalog.json` con backup e
controllo di revisione. Si applica a server di gioco fermo, usando lo stesso
blocco sui salvataggi del World Studio. Se un’altra finestra ha modificato
il catalogo, il salvataggio viene rifiutato; ricarica oppure conserva prima
le tue modifiche. Il Dungeon Maker aggiorna il catalogo tornando sulla
scheda o ricevendo la notifica dal laboratorio.

## Caricamento e struttura

- `shared/actor-catalog.json`: template di gioco e skin, in sezioni separate.
- `shared/actor-catalog.ts`: tipi e validazione dei dati.
- `client/render/actor-animation.ts`: selezione dello stato e calcolo frame.
- `client/render/actor-sprite-renderer.ts`: cache, ancoraggi, sprite e ombre.
- `client/render/boss-sprite-renderer.ts`: collegamento degli eventi del boss alle animazioni.
- `client/render/actor-renderer.ts`: elementi comuni e coordinamento del disegno.

All’avvio il server legge il catalogo corrente e risolve i riferimenti dei
dungeon. Modificare un template non richiede reinstallare quei dungeon.
Il client riceve le skin da `/api/actor-catalog`; gli asset vengono serviti
dal catalogo pubblico corrente anche in produzione. Dopo la prima build
di questo intervento, modifiche a valori e grafica richiedono il riavvio del
server e il ricaricamento del gioco, senza ricompilare il client.

I dungeon possono conservare override espliciti, che prevalgono sul
template. Nel Dungeon Maker **Eredita hitbox dal catalogo boss** mantiene
il raggio aggiornato; disattivandolo puoi impostarne uno per quel dungeon.
I valori personalizzati già presenti sono conservati dalla migrazione.

Gli attacchi e il risveglio sono sincronizzati con i tempi autorevoli del
server; la durata visuale del melee e della morte è configurabile. Un nuovo
comportamento di gioco richiede comunque codice: il catalogo permette di
configurare le meccaniche già implementate.

## Dungeon compatti

`shared/custom-dungeons.json` conserva gli ID dei template e gli override,
anziché una copia completa di ogni boss. Il terreno compilato usa sequenze
orizzontali e le bozze usano sequenze di caselle uguali. Entità, incontri,
regioni, passaggi, asset e posizioni restano invariati.

Importazione, aggiornamento e rimozione salvano automaticamente questo
formato. L’editor legge ancora le vecchie bozze; salvataggio locale ed
esportazione delle nuove bozze usano il terreno compatto.

Per migrare un vecchio catalogo a server fermo:

```sh
node --import tsx scripts/compact-dungeons.ts
```

La migrazione verifica equivalenza di geometria, spawn e valori dei boss,
crea un backup e sostituisce il file solo dopo i controlli. È idempotente.
Il catalogo del progetto è passato da 1.304.241 a 204.229 byte (−84,3%).
