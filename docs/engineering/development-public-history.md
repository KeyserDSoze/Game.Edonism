# Replay pubblico verificato — primo round Development (#37)

## Obiettivo PvP

I giocatori possono vedere la cronologia delle mosse e dei passaggi di turno, ma devono anche poter **ricostruire dove fosse ogni avversario** a ogni revisione verificata. Il pannello di storico non deve riprodurre effetti futuri delle carte, modificare la partita in corso o pretendere di sostituire il checkpoint di gioco con le mani private. I limiti delle regole canoniche restano quelli delle issue #4/#6.

## Contratto Domain

L'aggregato esistente `MatchAuditReplay.Verify(board, matchSnapshot)` rilegge la sequenza di eventi pubblici del primo round in ordine, con controllo di revisioni, attore in turno, movimento libero lungo strade adiacenti reali, unicità del movimento, chiusura del turno e ultima fase in attesa di settlement. Ora, oltre al risultato finale, produce `Frames`:

- Genesi: revisione 0, evento `match-created`, ordine iniziale e posizione pubblica di ogni partecipante.
- Ogni `free-move`: cambia la posizione e il flag di un solo attore, mantenendo invariati gli altri.
- Ogni `turn-ended`: avanza l'attore corrente nell'ordine di turno, senza spostare pedine.
- Ultimo `round-settlement-pending`: giocatore attivo null, `AwaitingRoundSettlement` ma **nessuna** erogazione di salario/nuove carte/elezione.

Ogni frame contiene `Revision`, `Kind`, `ActorId`, `Phase`, `ActivePlayerId` e una **copia immutabile** della lista `ReplayedMatchPlayer {PlayerId, StreetId, FreeMoveUsed}` di tutti i 2–8 partecipanti. Non memorizza token, digest, mani, mazzo, caratteri riservati o checkpoint. I frame sono pubblicati solo **dopo** la verifica completa dello snapshot e del log; se un evento futuro è ancora sconosciuto, se un evento manca o il risultato finale non quadra, `IsValid=false` e `Frames=[]`.

## API Development e autorizzazione

```http
GET /api/dev/matches/{matchId}/history
X-Edonism-Dev-Token: <bearer del posto>
```

Risposta solo per una capability valida e match con replay completamente verificato:

```json
{
  "matchId": "uuid",
  "verifiedRevision": 1,
  "frames": [
    { "revision": 0, "kind": "match-created", "actorId": "system",
      "phase": 0, "activePlayerId": "alice",
      "players": [{ "playerId": "alice", "streetId": "gauss", "freeMoveUsed": false }] },
    { "revision": 1, "kind": "free-move", "actorId": "alice",
      "phase": 0, "activePlayerId": "alice",
      "players": [{ "playerId": "alice", "streetId": "planck", "freeMoveUsed": true }] }
  ]
}
```

Il frammento mostra un solo giocatore per brevità; la risposta reale contiene **tutti i posti** anche nella genesi. Le strade effettive sono determinate dal setup/carte del server e non vanno fissate a priori nei test. Il contratto di response è `Cache-Control: no-store`, `Pragma: no-cache`, `Expires: 0` (#33); `404` per bearer errato/revocato, `404` in Production. Nessun parametro `playerId` può cambiare il posto autenticato. L'API storica è read-only e il checkpoint cifrato Development non cambia formato.

## Frontend accessibile

Il pannello `dev-history-panel` offre **Precedente**, **Successivo** e **Ultima revisione**, testo con la revisione storica, giocatore di turno storico, elenco di posizioni storiche per tutti i posti (con data attributes solo di playerId e streetId), e avviso di sola anteprima. I controlli sono pulsanti tastiera/screen-reader e tradotti IT/EN. `historyRevision=null` segue il frame più recente, mentre una scelta esplicita resta fissata alla revisione scelta fintanto che la storia completa viene aggiornata.

La richiesta `/history` è sempre in cache no-store, viene abortita al cambio di partita, token o posto e deve corrispondere alla revisione, agli eventi e allo stato finale del server. Dati sconosciuti, incompleti o obsoleti non sono mostrati. Un `404` della capability corrente segue il flusso fail-closed #31; un errore di rete della sola storia non concede mosse, non inventa eventi e non cancella validamente la mano. La scena 3D rimane ancorata allo snapshot live: **mai** pubblicare frame storici con `onPublicState` o ricalcolare i turn options dal replay.

## Regressioni

xUnit Domain: storia completa per 2 e 8 giocatori, movimento e flag per ogni revisione, ultimo frame uguale alla proiezione finale, fase di attesa settlement, reject tampering senza frame parziali. xUnit WebApplicationFactory: bearer scorretti, due posti, storia dopo mossa/fine turno, versione attuale, no-store, rotazione, Production 404 e nessuna carta privata.

Playwright mocked: mobile/EN, passaggio avanti/indietro, scenari invalidi o privi di cronologia, mano privata e comandi invariati, cambio posto cancella selezione storica. Playwright live: due browser che visualizzano il medesimo replay del server, mossa reale sulla strada scelta dai turn options, fase live indipendente dalla preview, token revocato non può più interrogare la storia.

Tracciamento: [issue #37](https://github.com/KeyserDSoze/Game.Edonism/issues/37), [ledger](development-ledger.md). CI obbligatoria prima della chiusura: xUnit, Playwright UI e Playwright real-API verdi sul commit finale di `main`.
