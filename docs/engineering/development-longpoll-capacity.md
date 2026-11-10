# Quote di long polling e fairness PvP Development — #36

## Minaccia e contesto

La #34 ha introdotto il long polling condizionale per notificare a un browser la nuova revisione della partita senza richieste continue, e la #35 l'idempotenza dei comandi. Ogni `GET` con ETag attuale e `Prefer: wait=N` però apriva una nuova `TaskCompletionSource` nel registro dei subscriber per-match, senza alcun massimo. Un singolo posto, pur valido, poteva aprire molte connessioni inattive e togliere risorse agli avversari. Il problema non richiede nuove interpretazioni del regolamento o dati delle carte.

## Limiti scelti

- Massimo **4 waiter contemporanei per attore autenticato**: più tab o browser dello stesso giocatore sono possibili, ma un solo attore non può monopolizzare una partita.
- Massimo **32 waiter per match**: copre fino a otto attori × quattro connessioni. È una soglia massima protettiva single-process; gli altri attori non sono bloccati da chi ha già esaurito la propria quota.
- L'identità dell'attore viene calcolata esclusivamente dal token presente nell'header `X-Edonism-Dev-Token`; il registro memorizza il solo `ActorId`, non il token o le carte private.
- Il controllo di identità e revisione precede **sempre** il controllo delle quote. Un bearer invalido/revocato non può inferire quante sottoscrizioni siano presenti.

## Contratto HTTP

Una richiesta autenticata di long poll, con ETag esatto corrente e `Prefer: wait=1..10`, riceve 200 alla mutazione, 304 al timeout, 404 su credenziale revocata, o **429** se l'attore ha già quattro waiter in sospeso (oppure il match è al massimo globale).

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 1
Cache-Control: no-store
Pragma: no-cache
Expires: 0
```

Non viene fornito nessun `ETag`, snapshot, ricevuta, mano, deck o token nella risposta congestionata. Il 429 non crea eventi o revisioni, non invalida la sessione e non autorizza azioni. `GET` senza ETag o `Prefer`, con ETag non corrente o preferenza non valida mantengono il comportamento originale senza occupare uno slot.

Il percorso di errore 404 ha priorità su 429 anche quando il posto è saturo. Se la credenziale viene ruotata durante l'attesa, la notifica #34 risveglia i waiter e il vecchio bearer è rivalidato come non autorizzato.

## Invarianti dello store

La sottoscrizione, insieme al controllo delle quote, avviene sotto `DevelopmentMatchStore.Entry.Gate`, condiviso con comandi, notifiche e rotazione del bearer. Il `TaskCompletionSource` utilizza `RunContinuationsAsynchronously`; la richiesta attende **senza tenere il lock**. Il `finally` rimuove la sottoscrizione su timeout, abort oppure wake-up, quindi i posti tornano disponibili. `NotifySubscribers` svuota la lista su eventi committati o rotazioni e non espone dati personali.

La quota non viene persistita nei checkpoint AES-GCM v2: una nuova istanza Development dopo restart riparte con zero connessioni, mentre mantiene stato, audit, mani riservate e idempotency receipts cifrate (#26/#35). Niente memoria statica condivisa fra server. Il prototipo non promette protezione da attacchi multiistanza o caching di intermediari non conformi.

## Comportamento React

Dopo un 429 ricevuto dalla lettura pubblica, `DevelopmentMatchLab` non tratta l'esito come 404: conserva `session`, `hand`, `lastPublicTag`, revisioni e comandi già confermati dal Domain. Per cinque secondi sospende l'header `Prefer` e continua a inviare il normale conditional GET con ETag, così può vedere comunque un turno nuovo. Scaduto il cooldown riprova a usare il long poll. L'effetto di polling riparte da zero su cambio di attore, match o token; nulla viene salvato in URL o Web Storage.

## Test

**xUnit API**: quattro waiter registrati per Alice, quinto GET con `Prefer: wait=5` ritorna 429 immediato, con `Retry-After` e `no-store`, senza ETag; Bob resta autorizzato; una mutazione notificata libera i waiter; credenziali false/mancanti 404, letture ordinarie funzionanti.

**xUnit store**: in match a otto giocatori 32 attese possono essere registrate contemporaneamente, la 33ª richiesta dell'attore saturo è rifiutata, la rotazione libera tutte le attese e invalida solo il vecchio bearer; timeout, cancellazione e nuovo turno rendono subito disponibili gli slot.

**Playwright mocked**: simulazione 429 dopo `Prefer: wait=5`, successiva lettura con ETag ma senza `Prefer`, nessuna revoca di mano/turno, mobile e inglese, browser storage privo di credenziali.

**Playwright live**: quattro long poll reali di Alice contro API .NET 10, quinto rifiutato rapidamente con 429 e header di privacy; il browser indipendente di Bob continua a ricevere il nuovo turno quando Alice esegue `end-turn`, con storico revisionale coerente.

**Fuori scope:** rate limiting globale, identity Production, DB/multi-instance pubsub, SignalR e regole #4/#6. Parent [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13) resta aperta. Checklist di tracking: [#36](https://github.com/KeyserDSoze/Game.Edonism/issues/36). Gate di chiusura: tre job CI xUnit/Playwright mocked/live verdi sul commit HEAD di `main`.
