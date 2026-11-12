# Igiene dei buffer delle capability PvP Development — #63

## Problema e confine

Ogni richiesta autenticata al laboratorio Development passa da `DevelopmentMatchStore.Entry.ResolveActor`. L'header `X-Edonism-Dev-Token` è una stringa esadecimale di 64 caratteri. Per abbinarla a una delle 2–8 identità di posto, il metodo alloca una nuova copia di **32 byte raw bearer** tramite `Convert.FromHexString` e un nuovo array di **32 byte SHA-256** tramite `SHA256.HashData`. Prima della correzione entrambi sopravvivevano al ritorno del metodo fino alla garbage collection.

## Contratto della correzione

- Dopo il parsing riuscito, un `finally` esterno cancella sempre la copia raw, compreso il caso di eccezioni durante il calcolo hash.
- Un `finally` interno cancella il digest temporaneo anche se il confronto trova un attore e il metodo ritorna immediatamente, o se nessuna identità corrisponde.
- Il confronto tramite `CryptographicOperations.FixedTimeEquals` con ogni digest persistente è invariato; **non** si cancellano i digest residenti dell'Entry, che devono essere disponibili ai bearer degli altri posti. Parsing malformato/assente -> nessun attore; bearer sconosciuto o ruotato -> nessun attore; lo snapshot e la mano privata restano actor-scoped.
- La persistenza cifrata v1/v2, la rotazione, il protocollo HTTP no-store, le mani private e l'idempotenza non cambiano. Non vengono registrati bearer in log, messaggi d'errore o storage client.

## Test

La regressione xUnit `RepeatedBearerAuthorizationClearsOnlyTemporaryBuffersAndRetainsSeatIsolation` crea una fixture full-deck con mani private distinte, esegue 32 cicli di autorizzazione per entrambi i posti con token corretti e non corretti, verifica la **stabilità dei digest** nel checkpoint dopo le letture e l'invariabilità delle quattro carte di ciascun posto. Verifica poi revoca della vecchia capability, rotazione della nuova e continuità dell'isolamento anche dopo restart cifrato. Rimangono i test parametrizzati 2–8 posti, autorizzazione API, UI Playwright mocked e Playwright live con vera API .NET.

L'azzeramento del buffer, una volta non più referenziato, è verificabile strutturalmente tramite i `try/finally` nel codice; un test black-box non può leggere in modo affidabile la memoria abbandonata dalla GC. Non si azzerano le stringhe immutabili dell'header HTTP, il contenuto di dump di processo o tutti i buffer intermedi della runtime. È **solo Development**; Production identity e persistenza distribuita rimangono in [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13).

[Issue #63](https://github.com/KeyserDSoze/Game.Edonism/issues/63) · [Ledger](development-ledger.md).


## Verifica senza scorciatoie basate sull'ordine dei posti (#64)

La cancellazione dei buffer della #63 non impediva una differenza di lavoro tra posti: prima `ResolveActor` ritornava appena un `FixedTimeEquals` trovava il digest. Per un token al primo posto bastava un confronto, al secondo due, fino all'ultimo degli 8 posti. Ora il codice mantiene un attore candidato mentre percorre **l'intero dizionario** e restituisce il risultato soltanto dopo l'ultimo confronto. La proprietà richiede che la mappa conservi digest univoci (#60); per ogni digest è sempre usato `CryptographicOperations.FixedTimeEquals`.

Il test parametrizzato `FirstMiddleAndLastSeatBearerResolveToOwnHandAfterFullScanAndRestart` verifica da 2 a 8 posti con carte private reali, lettura del primo/centrale/ultimo bearer, versioni minuscole della stringa esadecimale, token inesistenti e malformati, rotazione/revoca e restart da file AES-GCM. L'ispezione strutturale del ciclo verifica l'assenza di `return` anticipati: i test di durata sarebbero flakey e non attesterebbero l'assenza di tutte le differenze microarchitetturali. Il numero di posti e la durata complessiva della richiesta HTTP restano fuori dal contratto. Questa rimane esclusivamente un'API Development, non identità Production #13.

[Issue #64](https://github.com/KeyserDSoze/Game.Edonism/issues/64).
