# #144 — Verifica globale dei giocatori nelle quote lorde pubbliche

## Problema e confini

In Development, il riepilogo di stipendio lordo è **soltanto una proiezione pubblica in lettura**. Prima di #144 il validatore di `publicGrossSalaryQuotes` verificava già tutti i lotti stampati, le carte, le posture e i numeri 2 + attività in piedi, ma non richiedeva una pedina riconoscibile per **ogni** posto. Un rivale senza lotti controllati, con `streetId` non appartenente alla città, poteva sparire dai marker pur mantenendo una quota di 2 atoms nella lista apparentemente completa. Similmente si potevano accettare attori riservati/non sicuri o roster da 1 o 9 posti in questo helper isolato.

## Contratto #144

- Prima di mostrare **una qualsiasi** quota lorda, verificare un roster di **2–8 posti**; tutti gli `playerId` devono rispettare il protocollo tecnico Domain (`MatchParticipantId`) tramite l'helper già esistente `isValidDevelopmentTechnicalPlayerId` (case-sensitive, `system` riservato).
- La proiezione `playerMarkerPlacements` deve produrre **esattamente una pedina per ciascun posto**, usando le strade canoniche già presenti, senza ricavare movimento dalla geometria. Anche un rivale senza lotti deve essere collocabile.
- Una violazione nasconde **tutte** le quote; non cambia i lotti/pedine validi indipendentemente, la formula, il saldo atoms, i comandi server o la validazione dell'ingresso HTTP `hasValidDevelopmentPublicEnvelope`.
- Non sono introdotti API, PvP Production, identity reale (#13), effetti carte o fasi di gioco.

## Test di regressione

- **xUnit .NET Theory 2/4/8**: snapshot da catalogo personaggi/attività verificato, ID, strade, una quota per posto; invarianti dopo movimento e fine turno.
- **Playwright sul modulo TypeScript reale di Vite 2/4/8**: avversario legittimo senza lotti, identità `System` distinta da `system`, strada falsa o vuota, identità con whitespace/control/bidi, lunghezza eccedente, roster 1/9, immutabilità dei payload.
- **React Playwright mock già esistente 2/8**, mobile/no WebGL e IT/EN: quote, economia e risorse autentiche restano mostrate; ingressi invalidi non diventano turni autorizzati.
- **Playwright live .NET 2/8**: il proiettore browser riceve lo snapshot reale ed eguaglia tutte le quote .NET; verificato anche dopo un movimento autorizzato.

Tracciamento: [issue #144](https://github.com/KeyserDSoze/Game.Edonism/issues/144). Chiusura soltanto dopo CI GitHub Actions green sul commit finale di `main`.
