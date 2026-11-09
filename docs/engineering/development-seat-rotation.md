# Rotazione dei token per posto — Development-only (#28)

## Scopo

La [issue #28](https://github.com/KeyserDSoze/Game.Edonism/issues/28) aggiunge un controllo locale per rigenerare il **token bearer casuale a 256 bit** di un singolo posto, così una copia condivisa può essere revocata senza distruggere la partita. È un miglioramento della fixture Development #25/#26/#27, **non** il sistema di autenticazione o autorizzazione PvP Production (#13).

## Protocollo

```http
POST /api/dev/matches/{matchId}/rotate-token
X-Edonism-Dev-Token: <token-hex-corrente>
```

Il token viene letto **solo** dall'header, non da `playerId` in query/body. Il server risponde con `200`, unicamente `{ "playerId": "alice", "token": "<nuovo-token-hex>" }` e `Cache-Control: no-store`. Per assenza, falsificazione, token già revocato o partita inesistente risponde `404` indistinguibile. **In Production la route non viene registrata.**

La chiave di accesso nuova è generata da `RandomNumberGenerator.GetBytes(32)`. Il server conserva nel proprio store soltanto l'hash `SHA256` (con confronto digest a tempo costante); l'originale viene restituito una volta, nella sola risposta autenticata. Il vecchio token cessa subito di funzionare per `GET /hand`, `GET /audit`, `GET /{id}`, movimenti, fine turno e ulteriori rotazioni. Nessun altro posto perde accesso.

## Atomicità e recupero

Sotto lo stesso lock del match, il server verifica il digest corrente e prepara una **copia** dei digest con il solo posto sostituito. Se la persistenza AES-256-GCM opt-in di #26 è attiva, salva il nuovo set insieme al checkpoint privato completo e attende l'operazione atomica su disco **prima** di aggiornare la mappa in memoria. Un errore I/O lascia valido il vecchio token senza esposizioni di revisioni o segreti parziali. Un nuovo processo che legge directory e chiave corrette accetta il nuovo token ma non il vecchio. Con store volatile il cambio dura soltanto finché il processo rimane in esecuzione.

La rotazione è un'**operazione di credenziale**, non un comando di gioco. Non genera un evento di audit gameplay, non cambia `MatchSnapshot.Revision`, turno, round, mani, posizione, controlli o deck. Le letture pubbliche restano identiche.

## Uso da browser e limiti

Nel laboratorio React l'utente seleziona il proprio posto (il creator può scegliere tra tutti quelli di cui possiede ancora la credenziale) e preme **Rigenera token**. Se la risposta riesce, viene aggiornato soltanto il token in memoria associato a quel posto; la mano privata viene riletta dal server. Il pannello consente di copiare di nuovo ID e token; URL, localStorage, sessionStorage, WebGL, screenshot o pannelli pubblici non mostrano il segreto.

**Attenzione:** se Bob ruota il token da un secondo browser, la copia di Bob rimasta nel browser creatore diventa immediatamente inutilizzabile. Il creatore non può conoscere il nuovo token a meno che Bob lo ricondivida. Se la risposta alla rotazione si perde dopo che il server ha salvato la revoca, non è possibile riprovare con il token vecchio: conservare il nuovo token e riconnettersi manualmente o ricreare la fixture. Non esistono sessioni account, idempotency key, email recovery, riconciliazione cross-process o registri di revoca Production.

## Test

- `DevelopmentSeatRotationEndpointTests` (xUnit WebApplicationFactory): header come unica autorità, `404` su credential stale, isolamento mani, response no-store, nessuna modifica di snapshot, Production senza route.
- `DevelopmentCheckpointPersistenceTests`: ripristino del nuovo digest dopo restart, vecchio token revocato, file senza token in chiaro, errore di scrittura fail-closed, una sola rotazione riuscita fra 32 concorrenti.
- `development-match.spec.ts` (Playwright UI mocked): mobile, EN, privacy in storage/DOM, token rinnovato e vecchio invalido.
- `real-match.spec.ts` (Playwright full-stack): il browser Bob entra e ruota il proprio token contro ASP.NET Core reale, la copia precedente smette di funzionare e il round continua con due client indipendenti.

Il [ledger](development-ledger.md) e la [issue #28](https://github.com/KeyserDSoze/Game.Edonism/issues/28) indicano i job CI effettivamente superati; non dichiarare Production-ready il meccanismo.
