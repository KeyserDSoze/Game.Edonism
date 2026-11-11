# Admission limit per i creator delle partite Development — issue #46

## Problema e confini

In Development, le quattro route `POST /api/dev/matches[/]`, `/from-cards`, `/from-characters` e `/from-full-deck` sono intenzionalmente senza bearer: creano fixture locali ed emettono **tutte** le credenziali dei posti. Prima di #46 potevano allocare JSON arbitrariamente grandi e creare un numero indefinito di match a raffica. Il gate di #46 limita il consumo di risorse da parte di questi endpoint **senza rendere sicura la loro pubblicazione in Production**.

## Percorsi, controllo di dimensione e ordine

`DevelopmentMatchCreationAdmission.IsCreator` usa confronto esatto, case-insensitive, della route e metodo POST. I comandi di gioco, il bootstrap, le letture, le route `/api/v1` e URL con segmenti extra non sono coinvolti. Il middleware è inserito **prima di `UseRouting()` e della deserializzazione JSON**, ma dopo la policy globale `no-store` delle API Development (#33).

1. Una richiesta con `Content-Length > 131072` viene respinta immediatamente: `413 {code:dev_create_payload_too_large}`.
2. Un controller di ammissione singleton per processo concede **64 tentativi ogni 60 secondi**. Il sessantacinquesimo riceve `429 {code:dev_create_rate_limited}`, con `Retry-After` in secondi e `no-store`. Si contano i tentativi ammessi anche quando il fixture è semanticamente invalido. La finestra temporale fissa è basata su `TimeProvider`, usa un lock e si resetta alla scadenza o in presenza di clock rollback.
3. Per richieste ammesse di lunghezza non nota (ad esempio `Transfer-Encoding: chunked`) lo stream viene letto per **massimo 131073 byte**; il buffer non conserva mai oltre 131072 byte. Se supera il limite è `413`; altrimenti lo stesso stream bufferizzato viene riavvolto e passato al binder ASP.NET Core **senza parsing duplicato**. Lo stream di memoria viene eliminato al termine della richiesta.
4. Body eccessivi con `Content-Length` dichiarato non consumano la quota. Un body chunked che supera il limite dopo l'ammissione consuma un tentativo, senza creare sessioni. Non sono memorizzate credenziali o payload nei messaggi di errore.

I valori sono espliciti nel codice: `MaxJsonBytes = 128 * 1024`, `MaxAttemptsPerWindow = 64`, `Window = 60s`. Non sono regole del gioco né limiti di turno. Non c'è affidamento su IP, `X-Forwarded-For`, playerId o token controllati dal client per la quota.

## Interfaccia e compatibilità

Il laboratorio React mostra un errore localizzato `IT/EN` per 429 e 413 tramite `role=alert`, senza fingere che la partita sia stata creata; il controllo di creazione torna disponibile per un tentativo successivo. I quattro endpoint continuano a rilasciare fixture normali con `201`, e token/mani restano privati nelle rispettive proiezioni. I comandi `free-move`/`end-turn`, gli endpoint di lettura, l'audit e la presenza non sono sottoposti a questa quota. In Production le route Development non sono registrate.

Questa protezione **non limita il numero totale di match già presenti in memoria o sul disco**, non è un rate limiter distribuito e non equivale ad autenticazione, autorizzazione, anti-abuso o storage sicuri per multiplayer pubblico. La #13 rimane aperta per queste funzioni, e #6/#4 per il gameplay.

## Verifiche

xUnit testa controllo della finestra temporale, 128 tentativi concorrenti (64 ammessi), reset/clock rollback, matcher delle route, limiti esatti 131072/131073, `Transfer-Encoding: chunked`, 413 su tutte le quattro route, normali `201`, 429 + `Retry-After` con `no-store`, route non coinvolte e Production. Playwright UI verifica recupero su 429/413, messaggi IT/EN e nessuna sessione fantasma. Playwright live invia un payload superiore al limite e poi gioca una partita con due browser contro la vera API .NET.

Tracking [issue #46](https://github.com/KeyserDSoze/Game.Edonism/issues/46). Chiusura soltanto dopo GitHub Actions sull'ultimo HEAD `main`, con job xUnit + Playwright UI + Playwright live verdi.
