# Long polling condizionale autentificato — Development, issue #34

## Scopo

Il laboratorio multiplayer Edonism ha già token casuali per ogni posto (#28), snapshot pubblico con ETag revisionale (#30), azioni consentite dal Domain (#29), riconciliazione delle revoche (#31), bootstrap atomico della mano (#32) e risposta HTTP non-cacheable (#33). Fino alla #34, **ogni browser** chiedeva al server lo stato almeno ogni 1,5 secondi, anche su partite inattive. Da 2 a 8 posti questo comporta traffico ripetuto e un ritardo fino al poll successivo per vedere il turno avversario.

La nuova modalità opzionale sfrutta la stessa API pubblica Development, senza introdurre modifiche di regole PvP o un'autenticazione Production.

## Protocollo HTTP

```http
GET /api/dev/matches/{id}
X-Edonism-Dev-Token: <bearer-del-posto>
If-None-Match: W/"edonism-revision-0"
Prefer: wait=5
```

- Quando l'ETag corrisponde **esattamente** alla revisione attuale e `wait` è un intero 1–10, il server verifica il bearer, registra il subscriber per quella revisione e attende la prima notifica o il timeout.
- Se un comando viene accettato e pubblicato (dopo il checkpoint cifrato se attivo), la risposta è `200 OK` con il normale `MatchSnapshot` pubblico e il nuovo ETag.
- Se non succede nulla entro il timeout, la risposta è `304 Not Modified` con corpo vuoto e tag corrente. La lettura non cambia revisione, turni, carte o audit.
- Se l'attore ruota il bearer da un altro browser, la rotazione invia una notifica pur non modificando la revisione del gioco. Il vecchio subscriber viene **riautenticato** e riceve `404`; il nuovo bearer e gli altri posti rimangono validi.
- Se manca un ETag, il tag non corrisponde, è wildcard oppure `Prefer` è non valido/fuori range, il server risponde con l'ordinario GET **senza attesa**. Un token assente/errato riceve immediatamente 404.
- Tutte le risposte, comprese 200, 304 e 404, mantengono `Cache-Control: no-store`, `Pragma: no-cache` ed `Expires: 0` grazie alla policy #33. La credenziale è **solo nell'header**, mai in URL o ETag.

## Invarianti lato server

Il prototipo `DevelopmentMatchStore` rimane single-process. Ogni match conserva una lista di TCS per le richieste attualmente in attesa. Il waiter viene inserito **dentro `Entry.Gate`**, assieme al controllo di identità e revisione, quindi un comando non può inserirsi fra la verifica e la sottoscrizione; la chiamata `await` avviene fuori dal lock. Le continuations sono asincrone (`RunContinuationsAsynchronously`) e il waiter viene tolto in `finally` a timeout, segnale o cancellazione client. Una notifica svuota i subscriber e non tiene riferimenti a richieste terminate.

Le uniche notifiche arrivano dopo `TryExecute` accettato e committato, o `TryRotateSeatToken` dopo la persistenza del nuovo digest. Su un save fallito non si pubblica una revisione immaginata; su comandi rifiutati 409 nessuno viene risvegliato. Al termine dell'attesa il store **rivalida** il token sotto lock prima della lettura, proteggendo la revoca durante i secondi d'attesa. Il nuovo processo ricostruisce i segnali in memoria quando ricarica il checkpoint cifrato; non si persistono code o riferimenti ai subscriber.

## Browser React

Il polling esistente rimane il percorso ordinario: al primo accesso il client riceve 200, poi quando ha un ETag associato alla partita, al bearer e alla revisione **confermata dal server** aggiunge `If-None-Match` e `Prefer: wait=5`. La richiesta viene mantenuta aperta per un massimo di 5 secondi. In caso di 304 non effettua JSON parsing, in caso di 200 non accetta revisioni regressive, in caso di 404 riconcilia la revoca del solo bearer pertinente.

Al cambio di posto, token o partita, il controller dell'effetto annulla il long poll precedente. La scheda che si nasconde interrompe la richiesta attiva; al ritorno visibile, al focus o dopo `online`, il browser controlla di nuovo. Se una API precedente non supporta `Prefer` e ritorna 304 subito, il polling interval costituisce un fallback senza concedere comandi non validati. Il client conserva credenziali, ETag e mano privata esclusivamente in memoria, non in URL o Web Storage.

## Test

- **xUnit HTTP:** quiet timeout di 1 secondo, 304 senza corpo, fan-out di due bearer alla revisione nuova, 404 dopo rotazione durante l'attesa, invarianti di revisione, cancellazione del client, preferenze non valide o assenza di ETag, route Production assente.
- **xUnit checkpoint:** attesa e notifica dopo restore su un nuovo `DevelopmentMatchStore` da file AES-256-GCM, cancellazione, post-rotate 404 e lettura con nuova credenziale.
- **Playwright UI mocked:** invio della preferenza soltanto con ETag confermato, aggiornamento revisionale, ritorno online, reset dopo rotazione, viewport mobile e nessun token persistito. Un mock non prova il risveglio del server.
- **Playwright live:** due browser con API .NET 10 reale, `Prefer: wait=5` osservato nel browser Bob, richiesta condizionale sbloccata dal fine turno di Alice, comandi di Bob, no-store e privacy.

## Limiti

Solo Development: nessun broadcast inter-processo, Redis/pubsub, account, infrastruttura di push, identificazione o persistenza Production (#13). Non aggiunge settlement, politica, carte/effetti né modifica #4/#6. I client non devono considerare una notifica come autorizzazione: ogni comando è ancora validato dal Domain .NET e da `expectedRevision`.

Vedi [issue #34](https://github.com/KeyserDSoze/Game.Edonism/issues/34) e [development-ledger.md](development-ledger.md). Chiudere la issue solo dopo CI verde sul commit finale `main`.
