# Volo dei proiettili locali

Il proiettile del giocatore parte dal corpo visualizzato immediatamente. Il client ne predice soltanto la resa grafica; il server decide danno, collisioni e scomparsa. I proiettili remoti continuano a usare il buffer di interpolazione.

Due correzioni evitano l'effetto di frenata alla conferma:

- La traiettoria autorevole avanza alla velocità del proiettile per il tempo trascorso dallo snapshot. Il vecchio limite di 100 ms congelava il punto verso cui correggere il disegno quando gli aggiornamenti tardavano, rallentando il proiettile fino all'arrivo del pacchetto successivo.
- La correzione lungo la direzione di volo può modificare la velocità visiva al massimo del 15%. Un lancio eseguito più tardi dal server non può quindi trascinare il proiettile quasi indietro. Le correzioni trasversali per l'auto-aim restano morbide e la velocità/direzione confermata viene adottata prima del passo di movimento.

La durata massima del proiettile, gli sweep contro le pareti e la scomparsa confermata dal server continuano a limitare la predizione. Il ritardo dei pacchetti non può creare nuovi colpi o danni.

`tests/combat-presentation.test.ts` riproduce sia uno snapshot che invecchia oltre 100 ms sia una conferma tardiva del lancio; controlla che il volo non scenda sotto l'85% della velocità prevista. Il test browser `tests/integration/combat-browser.test.ts` verifica lancio, assenza di duplicati e velocità frame per frame con RTT emulato di 30, 150 e 300 ms, scegliendo percorsi liberi nella mappa corrente.
