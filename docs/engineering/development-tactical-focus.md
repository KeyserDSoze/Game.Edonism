# Focus tattico pubblico su città 3D — #52

## Obiettivo e confine PvP

Il laboratorio Development mostra due proiezioni autenticate in sola lettura:
- `GET /api/dev/matches/{id}/other-player-routes` (#51) elenca gli altri posti e i loro percorsi minimi.
- `GET /api/dev/matches/{id}/uncontrolled-routes` (#49/#50) elenca le attività pubbliche senza controllo con distanza e itinerario.

La #52 le trasforma in una navigazione **puramente visiva**: «Osserva sulla mappa» evidenzia le strade, la posizione del giocatore o l'edificio di un lotto; non aggiunge nessun endpoint, attacco, acquisto, limite ai movimenti, tempo di viaggio, missione o classificazione di alleati/nemici. Le cinque attività più vicine rimangono un'informazione, non una lista di obiettivi acquistabili. La logica di turno e movimento resta esclusivamente server-authoritative.

## Contratto pubblico fra laboratorio e città

`TacticalFocus` contiene solo `kind` (`player` o `activity`), `matchId`, `revision`, `actorId`, `targetId` e `streetPath` (ID strade inclusivi). **Non** contiene un bearer, ID di carte private, una mano, un portafoglio, fazione, postura segreta o coordinate 3D. Gli input nascono *solo* dalle due liste già validate nella `DevelopmentMatchLab`, dopo avere ricevuto da ASP.NET le proiezioni revision-bound.

La funzione pura `verifiedTacticalFocus(publicMatch, requested)` (in `src/frontend/src/features/city/tacticalFocus.ts`) verifica *di nuovo*:
1. `matchId` e `revision` identici allo snapshot pubblico attuale.
2. Posto attore unico e reale; per un giocatore, altro posto unico, diverso dall'attore e presente nello snapshot; per un lotto, slot canonico con esattamente una carta pubblica e **non** controllato.
3. Percorso canonico minimo ricalcolato da `shortestStreetPath` fra la strada dell'attore e quella del bersaglio. Confronto di **tutti** gli archi e delle estremità, non solo del numero di passaggi.
4. Se l'input è errato, nullo, obsoleto o senza destinazione, il focus non viene mostrato. Non si accettano coordinate inventate dal client.

L'oggetto validato è l'unico valore letto dalla scena per colorare strade, pedina o edificio. La scena non ricava spostamenti da pixel/mesh; le aree stradali sono di presentazione. Gli anelli del bersaglio sono distinti da quelli che indicano il giocatore di turno.

## UX, accessibilità e invalidazione

App mantiene al massimo **un** focus temporaneo in memoria React. Il click seleziona anche la strada e lo slot visitato; un riepilogo HTML (target, percorso con nomi delle strade, pulsante «Cancella focus») funziona con WebGL e con fallback senza 3D. Pulsanti in italiano/inglese, focus da tastiera, layout responsivo e nessuna dipendenza dal Canvas per l'ispezione.

Il focus si annulla quando cambia l'attore o il suo token, quando il POST di rotazione riesce, alla revoca, all'ingresso/uscita da partita, alla scelta manuale di un'altra strada o slot e **alla pubblicazione di ogni nuova revisione server**, anche prodotta da un avversario in un altro browser. `PublicMatchSceneState` porta `matchId` e `revision` per impedire che un callback tardivo riusi uno stato di un altro match. La presentazione non persiste selezioni o credenziali in URL, cookie o Web Storage.

## Test

- xUnit: confrontare per 2/4/8 giocatori il cammino e il numero di archi quando la proiezione dell'altro posto e la proiezione dell'attività libera condividono la stessa strada di destinazione; nessun cambiamento del checkpoint.
- Playwright mocked: focus player e attività, rimozione manuale, IT/EN, mobile, WebGL indisponibile, cambio posto, movement snapshot e leave; payload degli endpoint manomessi non offrono focus né abilitano comandi nuovi.
- Playwright live: due browser reali sulla stessa partita, target pubblico visitabile in entrambi, mossa .NET che invalida il focus anche per il browser dell'altro posto, nessun cambio revisione causato dalla sola osservazione.

Le suite di test non affermano che siano state approvate le inferenze di topologia #4/R-10. Nessun dato canonico di carte #19 è stato inventato. Traccia di completamento e CI finale in [#52](https://github.com/KeyserDSoze/Game.Edonism/issues/52).
