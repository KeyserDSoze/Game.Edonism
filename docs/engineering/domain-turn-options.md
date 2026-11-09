# Azioni disponibili al posto dal Domain — #29

## Confine di autorità

Il Domain .NET 10 continua a essere l'unica autorità per la partita PvP-first. La funzione **pura di lettura** `GameMatch.TurnOptionsForActor(actorId)` restituisce `MatchTurnOptions`, un contratto revisionato e separato dalle mani segrete. Contiene `matchId`, `playerId`, `revision`, `canEndTurn` e `freeMoveStreetIds`. Le destinazioni provengono direttamente dai `Neighbors` del grafo canonico della plancia in `BoardDefinition`, non dalle coordinate X/Z della città Three.js.

Sono rappresentati **solo due comandi del primo round** già implementati prima della issue: una mossa gratuita su strada adiacente e fine turno. Il giocatore fuori turno non ha opzioni; un giocatore che ha già eseguito la mossa può ancora terminare il turno ma non ottiene altre destinazioni; `AwaitingRoundSettlement` azzera tutte le opzioni. Nessuna regola di carte, dichiarazione, politica, tasse o elezione viene aggiunta.

## API Development

```http
GET /api/dev/matches/{id}/turn-options
X-Edonism-Dev-Token: <token-esadecimale-del-posto>
```

La route viene registrata **solo con ASPNETCORE_ENVIRONMENT=Development**, all'interno del prototipo #20. Lo store sotto lock del match risolve l'attore dal token casuale corrente, anche dopo la rotazione #28 e il recupero del checkpoint cifrato #26. La query `playerId` non può sostituire l'identità del token. In caso di credenziale invalida o partita inesistente ritorna `404`; per i successi `200` con `Cache-Control: no-store`. Il risultato **non include** token bearer, carte, draw pile o checkpoint privati.

La lettura non modifica `MatchSnapshot.Revision`, il registro degli eventi, le mani o la posizione. Non è una prenotazione o un lock del turno: ogni comando successivo verifica nuovamente identità, revisione e regole, e può comunque rispondere `409` in caso di race fra browser.

## React

Il pannello Development (sia creatore sia secondo browser con un singolo posto) carica le opzioni a creazione/join, cambio posto, cambio token, ogni revisione confermata tramite polling o comando/409. Usa la board client esclusivamente per mostrare i nomi umani delle strade fornite dalla API. Non costruisce mai destinazioni autorizzate dal layout 3D. Fino a una risposta valida gli input sono disabilitati, e le risposte sono accettate soltanto se appartengono allo **stesso ID partita, stesso posto, stesso bearer in memoria e stessa revisione**. Le fetch vengono abortite sui cambi sessione/attore: un risultato tardivo non deve poter autorizzare l'attore successivo.

La rotazione #28 invalida automaticamente le autorizzazioni legate al token vecchio. L'API in Production non espone nemmeno l'endpoint Development; il sistema Production di autenticazione rimane #13.

## Verifiche

- Test Domain: adiacenze 7 strade, opzioni delle fasi / revisione, nessuna mutazione, collezione immutabile, turno successivo e stop al settlement.
- xUnit API: lettura autenticata da due attori, non fidarsi di query `playerId`, 404 senza/vecchia credenziale, turno e revisione corrette, nessuna route Production.
- xUnit checkpoint: opzioni coerenti dopo restart con nuovo store cifrato.
- Playwright mocked: API assente, revisione errata, cambio posto, selezione esplorativa di una strada diversa, mobile/EN e risposta tardiva.
- Playwright live: due browser contro ASP.NET Core Development reale per lettura opzioni, movimento, turni e blocco settlement.

I test browser mocked non provano il protocollo reale; il gate full-stack è indispensabile. Prima della chiusura, verificare tutti e tre i job GitHub Actions su `main` e riportare i risultati in [issue #29](https://github.com/KeyserDSoze/Game.Edonism/issues/29) e [ledger](development-ledger.md).

**Verifica CI del codice:** [run #42719228127](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42719228127) sul commit `0cc3f35` ha superato 175 xUnit, 29 test UI e 8 full-stack, con tutti e tre i job verdi. La #29 resta una tranche Development: la #6 non è ancora completa.
