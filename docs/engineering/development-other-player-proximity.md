# Dossier PvP delle posizioni pubbliche — Development #51

## Scopo e limite delle informazioni

Il match del primo round espone già in uno snapshot **pubblico** gli ID dei posti, le rispettive strade, il controllo degli slot attività e la postura degli scagnozzi. La #51 aggiunge una proiezione consultiva per visualizzare questi dati **rispetto a un singolo posto** senza trasferire alcuna carta privata e senza inventare fazioni, alleati o nemici. Il sistema di attacco, le condizioni di vittoria, i poteri, la corruzione e gli acquisti sono fuori scope (#4/#7/#8/#19). La distanza minima in archi **non** è un numero di turni o permesso di movimento.

## Domain autoritativo, dati deterministici

`GameMatch.VerifiedOtherPlayerRoutesForActor(actorId)`:
1. Ottiene uno snapshot di partita e cerca il posto autorizzato; un attore non presente non riceve proiezione.
2. Verifica l'intero log del primo round con `MatchAuditReplay.Verify` e la revisione esatta. Nessuna mutazione di stato, evento, revision, controllo o stipendio avviene durante la lettura.
3. Per ognuno degli **altri** giocatori legge la posizione nello snapshot verificato e calcola il percorso minimo `BoardDefinition.ShortestStreetPath`: inclusivo di origine/destinazione, tie-break ordinal, array immutabile, distanza = conteggio archi del percorso. Se gli altri sono sulla stessa strada, distanza = 0 e percorso contiene un solo ID.
4. Conta solo le attività controllate pubblicamente per quel proprietario e quelle con `HenchmanPosture.Standing`; non ne deduce potenza militare o capacità di attacco. Ordina per distanza crescente e ID del giocatore ordinal e restituisce una lista immutabile.

Contratto:
`{matchId, playerId, round, verifiedRevision, fromStreetId, others:[{otherPlayerId, streetId, streetSteps, streetPath, controlledActivities, standingHenchmen}]}`.
La risposta non contiene token, mani/mazzo, fazione, wallet, cuori, obiettivi, tempo stimato o diritti di gameplay.

## Sicurezza, UI e sincronizzazione

`GET /api/dev/matches/{id}/other-player-routes` è disponibile **solo** in `Development`, usa `X-Edonism-Dev-Token` come gli altri endpoint Dev e risolve l'attore sotto lo stesso lock per mutazioni/rotazioni. Token mancante, falso o revocato: 404 indistinguibile; API e middleware mantengono `Cache-Control: no-store`. Nessun nuovo endpoint Production.

In React, il token rimane solo in memoria. Ogni cambio del match, revisione, posto o token invalida la lease e annulla la richiesta precedente. Prima di rendere **qualsiasi** riga il browser verifica l'intera lista contro lo snapshot pubblico già autorizzato: ID degli altri, assenza di duplicati, posizioni, numero dei controlli, postura, percorso minimo canonico (compresi estremi e tutte le strade), distanza, ordinamento per distanza e ID. Una risposta tardiva o incoerente rende il pannello *non disponibile*, senza effetti su mani, turn-options, storia e comandi. Le voci hanno etichette IT/EN, sono accessibili senza WebGL e restano leggibili su mobile.

## Test e validazione CI

- xUnit Domain: 2, 4, 8 posti, proiezione per ogni attore, conteggi dei controlli in piedi, tie-break, stesso-street=0, mutazione solo attraverso API di movimento autorizzato, serializzazione/immutabilità e checkpoint.
- xUnit HTTP: actor binding contro query spoofed, 404 token mancanti/falsi/revocati, no-store su 200/404, GET senza revision write, rotazione credenziale, isolamento Production.
- Playwright mocked: dossier IT/EN in mobile, cambio actor, stessa strada, dati falsificati (revisione, identità, distanza, percorso, conteggio), risposta del vecchio posto ritardata e nessun comando extra.
- Playwright live: due browser, due bearer privati, distanze, dati pubblici, movimento reale .NET e polling/refresh, nessun token esposto o mano di un altro posto.

Mantenere [#51](https://github.com/KeyserDSoze/Game.Edonism/issues/51) aperta fino alla CI **3/3 job success sullo stesso HEAD finale di main**. Topologia R-10 ancora soggetta ad approvazione del game designer in #4; Production identity/persistenza resta #13.
