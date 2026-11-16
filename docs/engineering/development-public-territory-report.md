# #158 — Territorio pubblico verificato dal server .NET

## Perché
La città React delle #152 e #157 espone lotti pubblici per strada, proprietario e postura; il browser non deve diventare l'autorità che attribuisce possesso o autorizzazioni. La nuova proiezione **read-only** del Domain .NET permette ai client PvP futuri di confrontarsi con la fonte server autorevole senza introdurre nuove azioni o regole non approvate.

## Contratto e confini
- `GameMatch.VerifiedPublicTerritoryForActor(actorId)` cattura uno snapshot e verifica il replay audit del primo round con la revisione corrente. Richiede tutte e 30 le carte su slot stampati unici, ID di carte fisiche unici e quote di categoria stampate; controlla owner, postura, slot e checksum di tutti i controlli.
- Il report restituisce `matchId`, `playerId` (identità derivata dal bearer, non dalla query), `round`, `verifiedRevision` e totali 30/free/controlled/shared. Ogni strada contiene ID/nome, lotti liberi/controllati, scagnozzi standing/fallen, `distinctOwnerCount` e `isShared`. Ogni owner incluso a zero segue l'ordine server dei 2–8 posti.
- `isShared` significa **due o più giocatori che controllano almeno un lotto ciascuno sulla stessa strada**; non implica attacco, bersaglio, vittoria, poteri, movimento o permessi di acquisizione.
- Tutte le collezioni annidate sono `ReadOnlyCollection`, create da copie; il DTO non contiene carte private, token, costi, saldi, fazioni né mazzo. Il Domain resta indipendente da ASP.NET Core.
- `GET /api/dev/matches/{matchId}/public-territory` esiste SOLO in Development. Il `DevelopmentMatchStore` risolve il token sotto il lock partita, poi restituisce 404 a bearer errato/assente/revocato, 409 `full_board_required` a un attore valido ma fixture legacy con board incompleta, 200 al full deck verificato. Le risposte sono no-store. Nessun nuovo POST.
- I movimenti gratuiti e la conclusione dei turni modificano solo la revisione e gli aspetti del turno; i controlli dei lotti restano invariati. Checkpoint restore non altera il riepilogo.

## Piano di test
- xUnit Domain full deck 2/4/8: match con snapshot e rotte avversarie, 7 × 2–8 owner, zero, posture, immutabilità, audit, mani private e checkpoint ripristinato, stabilità dopo free move/end-turn; legacy => null.
- xUnit API Development con vera `WebApplicationFactory` 2/4/8: 404 senza token o token inventato/revocato, 409 fixture parziale autenticata, 200 full board, no-store, nessun leak e identità solo dal bearer, Production 404.
- Playwright live (senza mock) per 2 e 8 posti: confronto della risposta .NET con le sette righe del DOM e le rotte pubbliche autenticate; nessuna mutazione di stato. Rimangono tutti gli altri test Playwright e xUnit.
- Issue-first, commit diretto su `main`. **Chiudere #158 solo dopo 3/3 CI success sullo stesso SHA finale**, annotando i risultati nell'issue e nel ledger. Parent #6 e dipendenze #4/#7/#8/#13/#19 ancora aperte.
