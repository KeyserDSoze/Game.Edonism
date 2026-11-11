# Convalida locale del replay pubblico — #55

## Vulnerabilità di presentazione

Il laboratorio Development mostra la cronologia autorizzata da `GET /api/dev/matches/{id}/history` (#37) e permette di esplorare una posizione storica sulla mappa (#54). Prima di #55, verificava match/revisione, numero di frame, alcuni identificatori e lo **stato finale**. Non verificava che posizioni, flag di movimento, attore e fase di ogni frame intermedio fossero coerenti con gli eventi pubblici. Un payload storico alterato ma con ultimo frame corretto poteva mostrarsi come se fosse verificato.

## Difesa in profondità, non nuova autorità

Il validatore puro `src/frontend/src/features/matches/verifiedPublicHistory.ts` riceve soltanto lo snapshot pubblico della partita live e la risposta history. Accetta esclusivamente gli eventi già supportati dal Domain del primo round: `match-created`, `free-move`, `turn-ended` e `round-settlement-pending`. La lista dei giocatori e l'ordine sono quelli dello snapshot pubblico.

1. Rifiuta incongruenze di match, revisioni, cardinalità 2–8, roster e genesis.
2. Parte da posizioni e flag correnti nello snapshot pubblico e **inverte** gli eventi `free-move` del ledger. Ogni inversa richiede arco canonico adiacente, destinazione identica alla posizione corrente e flag di movimento consumato. Nessun giocatore può avere ancora il flag consumato all'origine.
3. Ricalcola ogni transizione in ordine: unico attore di turno, una mossa gratuita, destinazione adiacente dal grafo pubblico, cambi di turno e fase finale solo nei punti già accettati da `.NET MatchAuditReplay`.
4. Confronta a ogni revisione **tutto** il frame con lo stato ricalcolato: `kind`, `actorId`, `activePlayerId`, `phase`, lista ordinata dei player, `streetId` e `freeMoveUsed`. Il risultato non è pubblicato se anche un solo confronto fallisce.

La vera autorità continua a essere il verificatore .NET, con i token bearer del Development MatchStore; il browser non autorizza azioni o modifica lo stato live. Il controllo in React è coerenza locale, non difesa contro un server malevolo o compromesso. Il client non registra credenziali/mani, non riproduce carte private, e rifiuta nuovi event kind non approvati.

## Integrazione con #37, #44 e #54

Il fetch `/history` mantiene `cache: "no-store"`, abort e verifica match/actor/token/revision. `verifiedPublicHistory` è chiamato **prima** di `setHistoryLease`: nessun frame parziale raggiunge il pannello replay, l'overlay sulla città o il cursore unread. La mancata verifica non revoca un token valido né cancella la mano. I comandi rimangono integralmente server-authoritative.

## Test e gate

Playwright mocked introduce una manomissione **del solo frame intermedio**, preservando genesis e ultimo frame: posizione valida ma falsa, flag `freeMoveUsed` errato, attore, seat attiva o fase diversi. Ogni caso nasconde la storia senza alterare lo snapshot live o la mano. Playwright parametrizza setup validi a 4/8 posti (oltre alla regressione a 2 posti); xUnit del Domain continua a verificare la sorgente reale, Playwright live su due browser mantiene il controllo del protocollo contro .NET. Chiudere [#55](https://github.com/KeyserDSoze/Game.Edonism/issues/55) soltanto dopo 3/3 job CI success sul commit HEAD finale di `main`.

Restano bloccate le regole in discussione di #4/#6 e i contenuti/API di #7/#13/#19; nessuna regola o fase è stata aggiunta.
