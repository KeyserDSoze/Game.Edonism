# Progressione verificata del primo round PvP — #43

**Perimetro:** Development-only, tranche incrementale di #6, versione 0.0.2. Nessuna decisione su timeout, presenza, rifornimento, politica o carte.

## Semantica Domain

`GameMatch.VerifiedFirstRoundTurnProgress()` costruisce uno snapshot **di sola lettura** dopo aver verificato la cronologia pubblica tramite `MatchAuditReplay.Verify(board, snapshot)`. I risultati comprendono `matchId`, `round=1`, `verifiedRevision`, `phase`, `activePlayerId`, `totalTurns`, `completedTurns`, `completedPlayerIds`, `remainingPlayerIds`. Le due sequenze preservano esattamente l'ordine originale del turno e contengono ogni posto una volta. Una `free-move` valida produce una nuova revisione **senza** aumentare `completedTurns`; `turn-ended` di un giocatore tranne l'ultimo sposta quel posto nella parte completata; `round-settlement-pending` completa tutti i posti e imposta `activePlayerId=null`. Le liste sono copie immutabili. Non sono state create nuove azioni.

## HTTP e privacy

Solo API Development: `GET /api/dev/matches/{id}/turn-progress`. `DevelopmentMatchStore` autentica `X-Edonism-Dev-Token` sotto lo stesso lock delle mosse, prima di chiamare il Domain. HTTP 200 con prospetto solo pubblico se valido; 404 con token mancante/revocato/falso o partita inesistente. Tutte le risposte hanno `Cache-Control: no-store` (#33), nessuna route in Production. Nessuna carta, mano, mazzo, wallet, digest o contatore di presenza è esposto.

## Interfaccia e sicurezza asincrona

Il laboratorio React mostra `Turni conclusi: X di N` / `Turns completed: X of N` e, in lista ordinata accessibile, `Concluso/Completed`, `In corso/Playing` e `In attesa/Waiting`. La lista deriva soltanto dalla proiezione .NET, con match/token/revisione/fase/ordine verificati contro lo snapshot pubblico corrente. Risposte HTTP tardive, deformate, vecchi posti e credenziali revocate non ripristinano la lista. Su logout locale il pannello sparisce immediatamente. Nessuna presenza online presunta; i controlli di gioco dipendono ancora dalle `turn-options` del Domain, non da questo indicatore.

## Test e governance

- xUnit Domain parametrizzati 2–8 posti, progressione/genesis/mosse/fine round, immutabilità, checkpoint senza mutazioni.
- xUnit WebApplicationFactory: bearer falso/assente/revocato, parità fra posti, no-store, Production disattivata, nessun credito o mutazione di audit.
- Playwright mock: transizioni e traduzioni IT/EN, mobile, race risposta vecchio token e risposta deformata.
- Playwright live: due browser autentici, cambio turno ricevuto via polling, completamento pending, rotazione token e privacy.

Tracking [#43](https://github.com/KeyserDSoze/Game.Edonism/issues/43). Parent #6 rimane aperta; per eventuali meccaniche multi-round attendere #4/R-07/R-09. La chiusura richiede tre job CI verdi sull'ultimo HEAD `main`.
