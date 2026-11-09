# Polling condizionale e sincronizzazione Development (#30)

## Perché

Le partite di sviluppo da 2 a 8 giocatori (#25/#27) utilizzano richieste browser autenticate ogni 1,5 s. In assenza di eventi il backend restituiva **l'intero** stato pubblico, con attività, scagnozzi e audit, per ciascun browser. La #30 riduce le risposte ridondanti e rende più pronta la ripresa dalla scheda in background. Non introduce un hub SignalR, un login Production o nuove meccaniche di gioco.

## Contratto API

```http
GET /api/dev/matches/{matchId}
X-Edonism-Dev-Token: <token-256-bit-del-posto>
If-None-Match: W/"edonism-revision-0"  # facoltativo
```

Il backend verifica **prima** il bearer del posto usando lo stesso `DevelopmentMatchStore` (#28). Se non è valido restituisce `404` indipendentemente dall'header `If-None-Match`. Per i match autenticati calcola il debole `ETag: W/"edonism-revision-N"` dalla sola **revisione pubblica**, non dal token, dalle mani o dai digest delle credenziali.

- Alla prima lettura, o se la revisione non coincide, risponde `200`, JSON del normale `MatchSnapshot`, ETag corrente e `Cache-Control: no-store`.
- Se il condizionale coincide (`If-None-Match` può contenere più tag) o è `*`, risponde `304 Not Modified`, corpo vuoto, tag corrente e `Cache-Control: no-store`.
- Dopo `free-move` o `end-turn` accettati, il Domain aumenta la revisione e il vecchio tag genera nuovamente `200`. La rotazione credenziali #28 non è una mossa di gioco e non cambia la revisione: l'accesso del vecchio token viene comunque negato con `404`.
- La route è registrata esclusivamente in ambiente Development; la sicurezza e persistenza Production restano oggetto della issue #13.

Il tag **non** è un token di autenticazione e non concede il diritto di leggere una partita. La verifica non può essere omessa nemmeno per una risposta 304.

## Comportamento React

Il laboratorio conserva il tag soltanto in `useRef`, associato a `matchId`, **token corrente** e revisione accettata. Invia un conditional GET solo quando tutte e tre coincidono; il tag non viene scritto in URL, `localStorage`, `sessionStorage` o scena WebGL. Per 304 non esegue `response.json()`, non forza un render della città e non ricalcola permessi. Per 200 applica soltanto uno snapshot della partita corrente con revisione monotona. I permessi di turno continuano a provenire da `GET /turn-options` (#29), non dai vicini del grafo nel client.

Le richieste precedenti sono annullate su cambio partita/token, mentre gli handler di `visibilitychange`, `focus` e `online` avviano un poll quando la pagina è visibile. Quando la scheda è nascosta, il timer non genera richieste. Un 304 non è mai un comando e non deve cambiare mano privata, revisione o movimento. Il comando successivo continua a verificare identità e `expectedRevision` in .NET, perché ETag non è una prenotazione di turno.

## Regressioni

- xUnit `DevelopmentConditionalPollingEndpointTests`: 200→304, header e nessun corpo, 200 dopo cambio revisione, token assente/falso, 404 su vecchio token dopo rotazione, nessuna fuga di carte/credenziali, checkpoint cifrato recuperato da un nuovo host.
- Playwright UI mock: due revisioni, polling 304 senza aggiornamenti, visibilità/online, viewport mobile, lingua inglese, dati non salvati nel browser.
- Playwright live: API ASP.NET Core reale, due browser isolati, tag scambiato fra due credenziali valide senza bypass autorizzazione, aggiornamento su fine turno di Alice e propagazione a Bob.

**Non incluso:** websocket, cancellazione sessione su offline, giochi Production, distribuzione multi-processo, rate limiting Production, carte, tasse o passaggio al secondo round. Fare riferimento all'[issue #30](https://github.com/KeyserDSoze/Game.Edonism/issues/30), al [ledger](development-ledger.md) e ai risultati CI prima di dichiararla completata.
