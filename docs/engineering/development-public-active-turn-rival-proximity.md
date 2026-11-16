# #147 — Vicinanza pubblica ai rivali dal giocatore attualmente di turno

## Contesto

Edonism 0.0.2 Development: la posizione su strada e l'attore di turno sono già parte della fotografia pubblica `.NET MatchSnapshot`; il grafo immutabile delle strade proviene dal file condiviso `src/shared/board/edonism-board.v1.json`. Il Domain implementa già la rotta più breve `BoardDefinition.ShortestStreetPath` e pubblica un'analoga vista autenticata del singolo attore via `GET /api/dev/matches/{matchId}/other-player-routes` (#51).

L'interfaccia cittadina può mostrare a tutti il numero di **passaggi fra strade** dall'attuale attore di turno ai rivali, senza far cambiare posto al visualizzatore o richiedere un nuovo endpoint.

## Regole di visualizzazione (NON gameplay)

`verifiedActiveTurnRivalProximity`:

1. accetta solo un contenitore di snapshot valido con **2–8** giocatori, ciascuno con identità tecnica valida e univoca (`isValidDevelopmentTechnicalPlayerId`) e una strada presente nella plancia canonica;
2. richiede `activePlayerId` valido e presente nel roster; quando la fase di settlement mette `activePlayerId=null`, restituisce una mappa vuota e **non inventa** un giocatore di turno;
3. riutilizza la verifica del posizionamento di **tutte** le pedine; ogni path `shortestStreetPath` è calcolato sul grafo condiviso con ordine deterministico;
4. restituisce solo i **N−1** rivali, con origine, destinazione, passaggi e percorso; zero passaggi è legittimo quando due pedine condividono una strada;
5. su un solo elemento incoerente ritorna una mappa **vuota**, mai una lista parziale che alteri il quadro strategico;
6. non legge carte private, token, fazioni, dadi, soldi o attività non correlate. Non genera un comando di movimento né una permission: i percorsi sono **topologia** e non dichiarazioni di legalità, attacco, costo o durata.

Il roster cittadino visualizza `Distanza in strade da [giocatore] (di turno): [N]` / `Street hops from turn owner [player]: [N]` con test-ID e dati pubblici del percorso, senza pulsanti aggiuntivi o richieste HTTP.

## Test automatizzati

- **xUnit Domain 2/4/8**: stessa posizione e stesso `ShortestStreetPath` di `VerifiedOtherPlayerRoutesForActor` per l'attore attivo, verificati a revisione zero, dopo free move e dopo end turn (attore cambiato); bilanci/mani private immutati, audit valido.
- **Playwright nel vero modulo Vite 2/4/8**: strade diverse, stessa strada a distanza zero, percorso ordinale, mossa, rotazione, attore nullo, 1/9 posti, ID doppio/riservato/malformato, strada estranea, input immutati e nessun campo segreto.
- **React Playwright mock 2/8**: badge in roster, IT/EN/mobile/no WebGL, stesso percorso e conteggi, aggiornamento dopo end turn, sparizione al pending settlement; nessun comando generato dalla semplice lettura, badge cuori/economia indipendenti.
- **Playwright live .NET 2/8**: ogni badge confrontato con il risultato del vero endpoint bearer `other-player-routes` alla medesima revisione; versione a 2 giocatori verifica la mossa, rotazione dell'attore e assenza dei badge a fine round.

## Confini

Nessun regolamento aggiunto per movimento/combattimento/politica (#4/#6/#8). Nessuna nuova capacità Production (#13). Issue di tracking [#147](https://github.com/KeyserDSoze/Game.Edonism/issues/147). Chiudere soltanto a CI verde 3/3 sull'HEAD definitivo di main.
