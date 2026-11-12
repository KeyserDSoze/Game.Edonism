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


## Emissione token e pulizia dei digest mai pubblicati (#65)

La generazione di capability non avviene durante la lettura dell'header ma **quando viene creato un match o ruotato il token di un singolo posto**. Prima queste due operazioni avevano loop distinti: il nuovo `byte[32]` raw e il digest SHA-256 calcolato potevano essere abbandonati al GC in caso di collisione, eccezione di conversione o salvataggio cifrato fallito. Ora entrambe usano `CreateUniqueSeatCapability`, che restituisce il nuovo digest solo dopo averne verificato l'unicità tramite `CryptographicOperations.FixedTimeEquals`, azzera il raw in ogni `finally` e azzera il digest del candidato scartato.

Il chiamante assume la proprietà del digest solo al commit. `Register` azzera tutti i digest dei posti creati se il salvataggio cifrato o la registrazione falliscono; non consuma la quota e non pubblica il match. `TryRotateSeatToken` azzera il nuovo digest se non arriva al commit, lascia intatti il digest precedente, la mano, la revisione e la presenza; dopo il commit cifrato e l'aggiornamento in memoria, azzera **il vecchio digest revocato**. I digest residenti di altri attori non vengono mai puliti durante la rotazione.

Regressioni xUnit: per ognuno dei 2–8 posti con mazzo completo, due rotazioni successive, revoca di tutti i token storici, corrispondenza tra hash dell'ultimo bearer e checkpoint cifrato, carte private invariate e restart. Un test forza l'errore al primo checkpoint prima del commit, ripara lo storage e dimostra che una nuova creazione resta ammessa con quota 1; rimangono validi gli scenari già presenti di errore I/O in rotazione e le suite Playwright UI/live. La cancellazione in heap è verificata tramite gli `try/finally` nel sorgente, non con misure temporali flakey. Le stringhe .NET contenenti token consegnati o candidati non sono cancellabili in modo garantito; questa rimane una funzione Development, non login Production (#13).

[Issue #65](https://github.com/KeyserDSoze/Game.Edonism/issues/65).


## Ownership dei digest decodificati in un restore cifrato (#66)

Durante `DevelopmentMatchStore.TryGetEntry`, il JSON del checkpoint viene decifrato e validato, poi i digest esadecimali dei posti sono decodificati in `byte[32]` indipendenti. Il JSON plaintext viene già azzerato dal file store (#62), ma questi nuovi buffer restavano nella memoria gestita se i receipt successivi erano falsificati o una seconda richiesta vinceva il ripristino concorrente.

La nuova logica assegna il dizionario di digest temporanei a un solo proprietario: `unpublished hashes` fino a quando il proprio `candidateEntry` non risulta **esattamente** la `Entry` restituita da `ConcurrentDictionary.GetOrAdd`. Un `finally` azzera tutti i digest se il candidato non è stato pubblicato, mentre il `finally` per singolo digest azzera quello già decodificato ma rifiutato prima di essere inserito. I digest di un altro Entry che ha vinto la corsa non vengono mai azzerati. Le verifiche sui receipt (#61), la deduplica di hash decodificati (#60), i vecchi file v1/v2 e i lock per partita sono invariati.

La nuova theory xUnit `ConcurrentFirstEncryptedRestoreNeverClearsWinningSeatDigests` esegue 64 richieste parallele con massimo 8 worker su un primo ripristino di 2–8 giocatori, verifica ciascuna mano privata e il bootstrap del relativo posto, quindi la rotazione di un token e un ulteriore restore dal checkpoint cifrato. Non è un test della cancellazione fisica della memoria abbandonata, verificata strutturalmente nel sorgente, e non equivale a autenticazione di produzione (#13).

[Issue #66](https://github.com/KeyserDSoze/Game.Edonism/issues/66).


## Reconnect cifrati: un solo restore concorrente per partita (#67)

Quando più browser Development tentano il primo reconnect allo stesso match, la precedente sequenza `_matches.TryGetValue → Load → Restore → GetOrAdd` lasciava che ogni richiesta eseguisse indipendentemente I/O, decrypt AES-GCM e validazioni. Il nuovo fast-path rimane lock-free per match già in memoria; su miss viene acquisita una delle **64 stripe di lock** determinate da `(uint)matchId.GetHashCode() % 64`, e la cache viene **ricontrollata sotto il lock**. Solo se è ancora vuota si procede al restore. Nessun dizionario di lock per GUID arbitrari cresce con il traffico anonimo.

Il lock copre esclusivamente il primo restore; non copre HTTP, long-poll o l'accesso a match già caricati. Due match freddi con la stessa stripe possono aspettarsi durante il restore, senza mutare i loro checkpoint. Il vincolo single-flight è per processo Development: Production richiede un piano DB/cluster distinto (#13).

La nuova theory xUnit `ParallelReconnectAcrossMatchesPreservesSeatsAndRejectsBadCheckpoint` valida 2–8 posti, due match cifrati reali con mani da quattro carte, un terzo checkpoint AES-GCM autenticato ma con digest duplicati e GUID inesistenti. Esegue 128 richieste parallele, verifica nessun cross-seat/cross-match leak, esegue rotazioni del token su entrambi i match e prova il nuovo restart. Il numero fisso di stripe e il double-check vengono verificati strutturalmente, non con benchmark temporali flakey.

[Issue #67](https://github.com/KeyserDSo/Game.Edonism/issues/67).
