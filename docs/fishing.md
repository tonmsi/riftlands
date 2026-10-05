# Pesca di riva

## Come giocare

Parla con Nereo e scegli **Vorrei imparare a pescare**: regala una canna per personaggio, lasciandola a terra come bottino privato. Il regalo è salvato e non dipende dalla missione delle interiora. Se la perdi, Ada vende una canna di ricambio per 10 gold.

Porta la canna nella sacca e usala vicino a una riva. Fuori dalle zone raggiungibili il suo simbolo è attenuato e l’uso spiega di avvicinarsi all’acqua. In questa versione tutti i bacini con terreno `water` nel mondo sono pescabili: mare, lago o fiume. Non si pesca in arena o battleground, né durante il combattimento.

1. Scegli un oggetto della sacca oppure **1 gold** dal selettore di esche. Viene decrementato subito quando lo monti: una unità resta riservata sulla canna. Canna e zaini sono esclusi; altri oggetti possono essere esclusi dal catalogo. La selezione indica se l’esca è riutilizzabile o quanti dei tre lanci rimangono.
2. Tocca/clicca il punto in acqua e premi **Lancia**, oppure trascina il mulinello nella direzione desiderata e rilascia. Su PC puoi usare **Spazio**. Il lancio deve finire nell’acqua a 40–260 unità e non può attraversare ostacoli o un’altra sponda.
3. Il galleggiante vola, produce uno spruzzo e lascia increspature. Il lancio ha **78%** di probabilità di produrre un’abboccata dopo 2,5–6 secondi; negli altri casi termina senza pesce dopo 7,5 secondi. Quando abbocca, tremolio e linee di movimento segnalano che hai **1,5 secondi** per ferrare.
4. Tieni premuto il mulinello/Spazio per recuperare; rilascia per allentare. Più alta è la tensione, più veloce è il recupero. Sopra il **99% per 850 ms consecutivi** il filo si spezza. Sotto il **55% per 2,2 secondi** il pesce si slama: non serve arrivare a zero. Il tempo di rischio di slamatura cala lentamente quando riprendi tensione.
5. La distanza sopra la lenza è un numero con virgola e due decimali, senza sigle: il valore residuo viene **moltiplicato per 5**, così recupero e fuga fanno scorrere rapidamente il contatore. Il galleggiante segue la distanza fisica. La cattura avviene subito a **1,5 metri fisici** dal giocatore, senza ulteriori soglie di tensione al traguardo. Il contatore sottrae questa distanza prima del moltiplicatore e mostra **0,00** soltanto alla cattura; prima mantiene almeno **0,01**. Un lancio lontano richiede più tempo. Il peso rallenta il recupero: con un grande siluro conviene tenere alta la tensione, allentando prima che il filo si spezzi. Durante la lotta canna e barra tremano e compaiono linee da fumetto, più intense con tensione alta. Il galleggiante mantiene le oscillazioni leggere e gli effetti in acqua originali. I dispositivi che supportano la vibrazione producono brevi impulsi; la preferenza di movimento ridotto disattiva questi effetti.
6. La cattura mostra una targa con nome, rarità, 72 coriandoli e peso che sale in 2,6 secondi, lentamente all’inizio. Non si può chiudere finché la pesatura non è terminata. Poi resta aperta fino a un tocco sulla targa o altrove (anche Spazio, Invio o Esc la chiudono). Durante il popup i comandi sottostanti sono bloccati. Pesci dello stesso tipo si accumulano nello stesso stack, specie diverse restano separate. Se la sacca è piena, il pesce viene lasciato a terra soltanto per te per **45 secondi**. Puoi rilanciare con la stessa esca finché rimane montata.

**Dopo un recupero senza abboccata o una cattura, l’esca resta montata e puoi rilanciare subito.** La moneta e le altre esche riutilizzabili non si deteriorano. Interiora, pesci usati come esca e pozioni durano **tre lanci validi**, anche se ritiri senza catturare nulla; al terzo si esauriscono. Un lancio rifiutato non consuma usi. Ferrata mancata, slamatura e rottura fanno perdere tutta l’esca: appare la stessa targa di perdita con la dicitura della causa. Rimane bloccata per i primi 1,5 secondi, anche con touch e tastiera; poi si chiude al tocco. I tre lanci valgono solo finché l’esca resta montata nella stessa sessione. Un’esca a 1/3 o 2/3 viene distrutta quando la cambi o termini la pesca, anche spostandoti: non torna nello zaino e non genera un oggetto a terra. Solo esche mai usate (3/3) e riutilizzabili vengono restituite quando chiudi senza un lancio in corso. Gli usi residui non vengono salvati negli oggetti; al riavvio si eliminano le vecchie esche usate già persistite. Interrompere un lancio in corso uscendo dalla pesca perde l’esca.

Premi ×/Esc per uscire. Muoversi di oltre 32 unità, subire un attacco, morire, cambiare istanza o disconnettersi termina la pesca e restituisce i normali attacchi. Durante un lancio l’esca e gli altri oggetti non possono essere venduti, gettati o usati attraverso le interazioni.

## Pesci e bilanciamento

| Pesce | Rarità | Peso | Preferenza | Comportamento |
| --- | --- | --- | --- | --- |
| Luccio argentato | Non comune | 0,8–2,8 kg | Esche brillanti, gold | Veloce, tensione variabile |
| Siluro di fondale | Raro | 3–8 kg | Interiora e altre esche organiche | Pesante, recupero lento |
| Persico di riva | Comune | 0,2–0,8 kg | Oggetti insoliti | Più facile da recuperare |

Le preferenze sono probabilistiche, non garantiscono una specie. Il peso aumenta lo sforzo di recupero. Il peso è mostrato per la cattura: gli stack nell’inventario conservano la specie e la quantità, senza pesi individuali.

## Moduli

- `shared/fishing/model.ts`: protocollo pesca, tipi, pesci, attrazione delle esche, limiti e tempi.
- `shared/fishing/config.ts`: probabilità di abboccata, tempi, distanza e soglie di rottura/slamatura.
- `shared/fishing/distance.ts`: distanza residua amplificata e formattata con virgola e due decimali. Il moltiplicatore `distanceDisplayMultiplier` è in `config.ts`.
- `shared/fishing/fight.ts`: velocità di recupero in base a tensione, specie e peso.
- `shared/fishing/water.ts`: riconoscimento delle rive e traiettorie valide, condiviso fra server e client.
- `server/fishing/fishing-system.ts`: stato autorevole, estrazione del pesce, finestre temporali, tensione, esche e catture.
- `client/fishing/fishing-ui.ts` e `fishing.css`: selettore, mulinello, avvisi e indicatori per PC e touch.
- `client/fishing/world-art.ts` e `item-art.ts`: canna, lenza, galleggiante, spruzzo e icone.

I punti di integrazione sono piccoli: la simulazione inoltra i comandi e blocca i cast, lo snapshot include lo stato solo per il proprietario, il client monta la UI e chiama il disegno della pesca. Si riusano trasporto con room/epoch, inventario, persistenza per personaggio, bottino personale e feedback degli oggetti. Il modulo non gestisce copie proprie di questi sistemi.

Per aggiungere esche brillanti o organiche imposta `fishingBait: 'shiny' | 'organic'` in `shared/items.ts`; il valore predefinito è `odd`. **`fishingBait: false` esclude un oggetto**. Le future gemme presenti nell’inventario possono usare questo stesso campo. Una futura valuta in un saldo separato richiederà un adattatore come quello dei gold.

## Percentuali e PNG

Modifica **`biteChance` in `shared/fishing/config.ts`**: `.78` significa 78% di probabilità che un lancio abbia un’abboccata. In `shared/fishing/model.ts`, `spawnWeight` regola la rarità di ciascun pesce e `attraction` la preferenza per l’esca. Il peso effettivo è `spawnWeight × attraction[tipoEsca]`, normalizzato rispetto alla somma dei pesi delle specie: sono probabilità condizionate all’abboccata, non percentuali assolute per lancio.

Puoi sostituire le grafiche procedurali con PNG trasparenti: **`assets/fish-pike.png`**, **`assets/fish-catfish.png`**, **`assets/fish-perch.png`**. Un’immagine singola, preferibilmente quadrata da 256×256 o 512×512, funziona in targa, sacca, selettore e bottino a terra. Manteniamo le proporzioni. Se il file manca resta la grafica procedurale. Dopo aver aggiunto i PNG riavvia il server di sviluppo o ricrea la build di produzione e ricarica la pagina.

Le future varianti albine possono avere un ID distinto, un proprio `spawnWeight` e PNG `fish-<variante>.png`; vanno registrate sia tra i pesci sia nel catalogo oggetti. Questo evita di mischiare la variante rara con lo stack della specie normale. Le varianti albine non sono ancora presenti.

Il regalo è configurato nei dialoghi di `shared/narrative.ts`; la canna di ricambio è in `shared/vendors.ts`. Oggetti, persistenza e pesci devono avere ID coerenti nel catalogo.

Per le esche che si deteriorano imposta **`fishingBaitConsumable: true`** in `shared/items.ts`. Il valore predefinito rende l’esca riutilizzabile; le cariche residue sono autorevoli e non possono essere ripristinate dal client.

Client e server richiedono **protocollo 16**: dopo la modifica riavvia il server e aggiorna la pagina.
