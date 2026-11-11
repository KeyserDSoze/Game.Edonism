# Ispezione storica della posizione pubblica sulla città — #54

## Perimetro

Il replay del primo round autorizzato da `GET /api/dev/matches/{id}/history` (#37) viene verificato dal Domain .NET e presentato nel laboratorio Development. #54 permette di scegliere una **posizione storica** e colorare la relativa strada nella scena (ambra, distinta dal teal del focus tattico corrente) e in un riepilogo HTML. Le pedine, lo stato, il turno, le opzioni e la mano rimangono sempre **LIVE**, mai riposizionati dal frame storico.

## Contratto e sicurezza

La callback `onHistoricalFocus` porta solo `{ matchId, sourceRevision, historyRevision, playerId, streetId }`. Il laboratorio accetta un click solo con stessa sessione/actor/token correnti, storia valida per la revisione live e player/street identici nel frame selezionato. Nessuna credenziale e nessun contenuto privato entra in App, Three.js, URL o Web Storage. Il puro `verifiedHistoricalStreetFocus` rivalida revisione live, intervallo storico, identità pubblica e ID di strada stampata. Questa difesa frontend è solo per coerenza di presentazione: **l'autorità sulle transizioni storiche rimane `.NET MatchAuditReplay`**.

Un nuovo snapshot, revoca, rotazione, cambio seat, leave, cambio revisione timeline o scelta manuale della plancia annulla il focus. La selezione è separata e mutuamente esclusiva dal focus tattico (#52/#53). Il colore viene dagli ID delle strade pubbliche, non da coordinate di movimento o permessi di acquisto/attacco.

## Test

Playwright mocked IT/EN: scelta storico #0 dopo movimento live #1, posizione live invariata, revisione e comandi invariati, clear/cambio frame, switch seat e token rotation; storia corrotta non offre il controllo. Mobile italiano senza WebGL verifica ancora l'accessibilità. Playwright full-stack: due browser osservano un replay verificato .NET, selezionano la strada passata, e il marker LIVE con relativa revisione non cambia. I test xUnit di replay deterministico restano gate obbligatorio. La [issue #54](https://github.com/KeyserDSoze/Game.Edonism/issues/54) richiede **3 job verdi sul medesimo HEAD di main**.

Non introduce fasi di round, salario, tasse, acquisti, elezioni, combattimento o persistenza Production: #4/#6/#7/#8/#13/#19.
