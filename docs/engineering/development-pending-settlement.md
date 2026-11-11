# Edonism — anteprima di saldo del primo round (#42)

## Contratto verificato, senza mutazioni

La versione stampata [`rulebook2.zip` p. 5] prevede un salario di **2 atoms base + 1 per ogni attività controllata con scagnozzo in piedi**. È un importo **lordo**: tasse, Innovate, corruzione e altre regole ancora da verificare (#4/R-08, #6/#7) impediscono di accreditare automaticamente il wallet.

Quando tutti i 2–8 giocatori hanno terminato il turno, `GameMatch` entra nello stato `AwaitingRoundSettlement`. `PendingSettlementPreview()` controlla l'audit pubblico del primo round e restituisce un oggetto **immutabile** con `matchId`, `round = 1`, `verifiedRevision`, `nextTurnOrder` (ordine *proposto*, non applicato) e `grossSalaryQuotes` per ogni attore. Prima della fase pending ritorna `null`; non applica comandi, eventi, paga, refill, elezioni, rialzo scagnozzi o nuovo round.

## API e confini di fiducia

Solo `Development`: `GET /api/dev/matches/{id}/settlement-preview`. Il bearer `X-Edonism-Dev-Token` determina l'autorizzazione sotto il lock della partita, **prima** di rivelare se la fase è pending: token falso/revocato/assente/partita sconosciuta -> `404`; attore valido con round ancora in corso -> `409 round_not_pending`; attore valido a fine round -> `200` con la proiezione. Tutte le risposte sono `Cache-Control: no-store` e non riportano mani, deck, bearer, ID carta o wallet delta. Nessuna route in Production; il creator dei fixture locali possiede ancora tutti i token (#13).

## UI e verifiche

Il client rende la previsione solo quando il suo snapshot live è in fase pending, e solo se l'API restituisce stesso match, round, revisione, ordine e quote lorde del server. Il risultato è vincolato all'esatta credenziale attuale; richieste abortite, 409, risposte tardive e dati malformati non possono creare pagamenti né ripristinare schede vecchie. UI i18next IT/EN con etichette chiare **lordo previsto, non pagato**, e layout mobile. Il rendering non influisce su comandi o città 3D.

xUnit: da 2 a 8 attori, quote, ordine, invarianti, copie immutabili, no mutations; HTTP WebApplicationFactory per 409/404/200, revoca/no-store e route non Production. Playwright mocked: pre/pending, UI EN/mobile, dati invalidi e risposte tardive; Playwright live: due browser, REST reale, salario lordo e atoms originali invariati. L'issue #42 viene chiusa dopo CI verde sull'ultimo HEAD di `main`.
