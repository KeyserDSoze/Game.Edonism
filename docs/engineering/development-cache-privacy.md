# Cache privacy delle API multiplayer Development — #33

## Problema verificato

Nella fixture locale Edonism, `POST /api/dev/matches/from-full-deck` (come le altre tre create) restituisce **tutti i bearer da 256 bit** del creator. `GET /api/dev/matches/{id}/hand` restituisce carte private. Le risposte della lettura pubblica, della rotazione e delle opzioni avevano in parte un header `no-store`, ma non tutte le create o le mani. Un browser che usa `fetch(..., { cache: "no-store" })` non sostituisce una direttiva della risposta server per tutte le componenti HTTP e per eventuali caching intermedi.

L'obiettivo è prevenire la conservazione di questi dati da parte di cache HTTP conformi. Non è un sistema di autenticazione Production, non protegge da processi o proxy che ignorano le direttive e non cancella screenshot, copie già lette o log esterni.

## Contratto HTTP

**Ambiente:** soltanto `ASPNETCORE_ENVIRONMENT=Development`. **Path:** l'intero segmento `/api/dev/matches` con sottopath. Tutte le risposte inviano:

```http
Cache-Control: no-store
Pragma: no-cache
Expires: 0
```

Le direttive non contengono mai token, digest o informazioni riservate. `Cache-Control: no-store` è la direttiva HTTP primaria; `Pragma` e `Expires` sono un'ulteriore compatibilità per client legacy. `no-store` non è un meccanismo di autenticazione né blocca che un utente autorizzato copi i dati ricevuti.

**Copertura:** `201` su `/`, `/from-cards`, `/from-characters`, `/from-full-deck`; `200` su snapshot, `/seat`, `/hand`, `/turn-options`, `/audit`, `/rotate-token` e comandi; `304` del conditional GET autenticato; `400` per setup non valido e JSON malformato; `404` per match non trovato, bearer assente/falso/revocato o URL non registrato; `409` di turno o revisione non validi. I payload e i codici esistenti restano invariati. Un token revocato non ottiene mai 304, indipendentemente dall'ETag.

## Implementazione

Il middleware si trova in `src/backend/applications/Edonism.Api/Program.cs`, registrato soltanto quando `app.Environment.IsDevelopment()`, prima di CORS e mapping. Si applica quando `Request.Path.StartsWithSegments("/api/dev/matches")`, senza matchare path arbitrari simili come `/api/dev/matches-extra`.

Gli header sono impostati all'ingresso e ribaditi in `HttpResponse.OnStarting`. È importante: i test HTTP reali hanno evidenziato che un JSON malformato può produrre una `BadHttpRequestException` con risposta 400 ricostruita dall'error handling ASP.NET; questo percorso **può cancellare gli header impostati in precedenza**. Il callback in fase finale li ristabilisce anche in quel caso. Le route non devono impostarli una per una.

L'ambiente Production non registra il middleware né le API Development. Gli endpoint pubblici `/health`, `/api/v1/meta`, `/api/v1/board` continuano a funzionare senza passare da questa policy specifica.

## Verifiche

`DevelopmentNoStoreResponseTests` (xUnit e WebApplicationFactory) verifica le quattro risposte di create con i token, tutte le letture private, 304 e 200 del polling, POST che accettano o rifiutano una revisione, rotation e revoca del bearer, 404 sconosciuto, 400 di validazione e di binding JSON invalido, Production senza endpoint Development e contenuto invariato delle route pubbliche.

La suite Playwright mocked riflette gli header nei fixture, e assicura che cambiando posto il browser carichi solo la nuova mano senza memorizzare credenziali in URL/Web Storage; **non** dimostra il funzionamento del middleware. Playwright full-stack legge invece gli header effettivi dell'ASP.NET Core Development dal browser e dai client di test, comprese le credenziali del creator, le mani, 304, 400, 404, 409 e la rigenerazione di un token. Non registrare token nelle assertion failure o nei log.

La policy è una tranche preparatoria della [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13), non un'implementazione di account, login, autorizzazione Production, persistenza multi-instance o politiche di cache della futura infrastruttura.

Tracciamento: [issue #33](https://github.com/KeyserDSoze/Game.Edonism/issues/33) e [ledger](development-ledger.md). La chiusura avviene **solo dopo** CI su ultimo `main` con xUnit, Playwright mocked e Playwright live tutti verdi.
