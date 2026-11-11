# Edonism — uscita volontaria dalla sessione Development (#39)

## Perché esiste

Chi prova il laboratorio PvP con 2–8 posti può abbandonare volontariamente la **sessione del browser** senza ricaricare l'applicazione e senza alterare il match autoritativo. Questa funzione esiste soltanto in Development, non è un account Production e non prova che una persona sia disconnessa dal server.

## Contratto di sicurezza

- Il pulsante `dev-leave` appare soltanto nella sessione attiva; è disabilitato durante comandi e rotazione del token.
- Prima di cambiare lo stato React, l'handler invalida refs di match, seat, bearer, revisione ed ETag, e la bootstrap lease. Cancella poi sessione, credenziali ricevute dal creatore, mano privata, opzioni Domain, storico selezionato, presence, errori, note di rotazione e campi del form join. Il marker pubblico della città torna in modalità preview.
- `useEffect` smonta e abortisce le richieste associate a match/actor/token: snapshot polling e long poll, presenza POST, mano privata, turn options e replay. Un'eventuale risposta tardiva della mano deve superare anche il controllo dello scope corrente, non basta non essere stata abortita.
- Nessuna API `logout` o modifica del Domain: la revisione, la cronologia, le mani e i token **server-side** rimangono invariati. Un altro browser continua a giocare. Il heartbeat remoto diventa inattivo solo allo scadere del TTL di #38 se nessun altro tab invia segnali.
- Non salvare token in URL, storage del browser, telemetry o log. L'uscita non può cancellare copie già condivise o il clipboard. Per invalidare esplicitamente una capability usare rotazione (#28). Real identity/revoca multi-instance e logout Production sono #13.

## Test

Playwright mocked verifica accessibilità IT/EN mobile, che non rimangano proiezioni/token/input dopo l'uscita, che non partano altri heartbeat/poll dopo un ciclo di 5 secondi, che una risposta tardiva non ripristini UI, e che un rientro richieda un nuovo bootstrap. Playwright live verifica con due browser che la disconnessione locale non tocchi API .NET, revoca, mano o revisione del match. La CI continua a eseguire xUnit backend per evitare regressioni trasversali. Chiudere #39 solo dopo i tre job verdi su ultimo HEAD.

## CI del codice

La [run #43002910518](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43002910518) sul commit `19a402e` ha verificato **220 test xUnit**, **54 Playwright UI** e **19 Playwright full-stack live** (tutti passati). L'ultimo commit documentale richiede la propria CI prima della chiusura dell'issue.
