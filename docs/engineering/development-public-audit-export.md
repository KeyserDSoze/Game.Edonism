# Edonism — esportazione del replay pubblico Development (#68)

## Scopo e confini

La prima verticale PvP Development dispone di `/api/dev/matches/{id}/history`, endpoint autenticato per posto, senza cache e verificato dal Domain `.NET MatchAuditReplay`. Il browser riceve anche lo snapshot pubblico corrente e applica il validatore indipendente `verifiedPublicHistory` che rigetta revisioni non allineate, posizioni incoerenti, eventi sconosciuti e frame intermedi manipolati (#55). L'esportatore non introduce alcun nuovo endpoint server e non rende pubblica anonimamente una partita.

Il pulsante **Esporta JSON pubblico** / **Export public JSON** è presente nel pannello di replay del laboratorio, disabilitato se la cronologia è assente/invalida. Al click ricontrolla l'identità in memoria della capability corrente (match, posto, token, revisione), riesegue `verifiedPublicHistory` e costruisce il file **solo con proiezioni a campi espliciti**, non con spread di snapshot, sessione o risposta HTTP. Il browser usa un Blob temporaneo, un URL oggetto revocato e un filename basato soltanto su GUID match e revisione. Non persiste token o prove nel browser storage.

## Schema v1

`edonism-public-audit-v1` è una prova *informativa e non firmata* della cronologia pubblica attualmente verificata. Non è audit di eventi completi delle carte né un file di ripristino. Lo schema JSON ammette **solo**:

- Root: `format`, `matchId`, `round` (=1), `verifiedRevision`, `events`, `frames`.
- `events[]`: `revision`, `round`, `kind`, `actorId`, `fromStreetId`, `toStreetId` per i quattro tipi pubblici già implementati.
- `frames[]`: `revision`, `kind`, `actorId`, `phase`, `activePlayerId`, `players`; per `players[]`: `playerId`, `streetId`, `freeMoveUsed`.

La UI non esporta token, `DemoSession`, `credentials`, `hand`, `cardIds`, `PrivateDeal`, mazzo nascosto, future fazioni o chiavi idempotenti. Per estendere lo schema a nuovi eventi serve una nuova issue, aggiornare il contratto Domain, rivedere la whitelist ed incrementare la versione export. Non spacciare il file per prova firmata o per replica autoritativa del server.

## Regressioni e gate

- xUnit `DevelopmentHistoryEndpointTests.EverySeatReceivesOnlyWhitelistedPublicHistoryFields` su 2–8 posti, dopo un evento valido: risposta `/history` con campi **esatti**, zero token, carte private e digest; la permission resta legata al bearer.
- Playwright mocked su 2 e 8 posti: file JSON reale, ordinamento revisioni, campi per evento/frame/giocatore, assenza credenziali e carte, lingua IT/EN e mobile, nessuna mutazione del turno; scenari history unavailable, kind sconosciuto e frame intermedio alterato disabilitano il pulsante.
- Playwright live contro API .NET: dopo un movimento autorizzato, il download del browser coincide con `/history` e con gli eventi dello snapshot pubblico della stessa revisione; confronta anche l'assenza di token di entrambi i posti e carte private.
- GitHub Actions xUnit + Playwright UI + Playwright real .NET devono essere **3/3 verdi sul commit finale di `main`** prima della chiusura.

Questo è un supporto di trasparenza **Development-only**: login Production, persistenza multi-istanza e la definizione completa delle regole rimangono nelle issue #13/#6/#4.

[Issue #68](https://github.com/KeyserDSoze/Game.Edonism/issues/68).

## Verifica locale di coerenza del JSON esportato (#69)

Il pannello **Controllo locale del replay pubblico** / **Offline public replay check** è presente anche prima di creare o raggiungere un match. Consente di selezionare un file precedentemente ottenuto tramite l'export #68; il browser rifiuta file vuoti o oltre **64 KiB prima della lettura**. Nessun token, URL API, HTTP call, sessione, mano privata, storage persistente o movimento live viene usato dall'import. La selezione successiva invalida un'eventuale lettura in ritardo. L'input file è azzerato dopo l'avvio del controllo.

La funzione pura `verifyPublicAuditFile(unknown)` è indipendente dallo stato live. Richiede una versione v1 conosciuta, GUID match, round 1, campi esatti senza proprietà extra, 2–8 player ID distinti e validi, revisioni intere contigue (0..16). Utilizza il primo frame come stato pubblico iniziale e ricostruisce, evento per evento, l'ordine dei turni e le posizioni; per ogni `free-move` controlla `isAdjacentStreet` sulla topologia della plancia, uso massimo una volta, attore corrente e partenza corretta. Per `turn-ended` e `round-settlement-pending` controlla l'ultimo attore e la transizione di fase. Ogni frame deve coincidere con stato calcolato: attore, fase, mosse effettuate, ID e posizioni pubbliche. Unknown future event kinds, stato alterato, informazioni extra e round successivi vengono rifiutati fino a nuova revisione del contratto.

**Il verificatore NON dimostra che i dati siano davvero stati prodotti dal server Edonism.** Il JSON #68 è esportato come prova informativa non firmata; un malintenzionato può crearne uno falso ma internamente coerente. Il risultato dice espressamente **«internamente coerente; origine non verificata»**. Non importiamo posizioni live, non riveliamo le carte, non generiamo replay di gioco interattivo e non autorizziamo azioni.

La suite automatica comprende xUnit della cronologia pubblica del primo round dopo la terminazione di tutti i 2–8 posti, Playwright UI che esporta e reimporta in un browser fresco senza capability (2 e 8 posti, IT/EN/mobile, corruzioni e oversized), e Playwright live che ripete la verifica usando un export ottenuto dalla vera API .NET. La CI richiede 3/3 job verdi sullo stesso HEAD finale.

[Issue #69](https://github.com/KeyserDSoze/Game.Edonism/issues/69).


## Timeline read-only degli eventi pubblici offline (#70)

Il controllo del file `edonism-public-audit-v1` (issue #69) può ora aprire un **visualizzatore consultabile delle revisioni**. Un secondo browser privo di token o partita può caricare un export da #68, iniziare dalla revisione 0, premere **Precedente/Successivo** fino all'ultima e leggere evento/attore, fase e turno, posizioni e flag `freeMoveUsed` degli altri 2–8 giocatori. A fine round il pannello mostra «saldo in attesa» senza far avanzare il gioco. Le revisioni estremali disabilitano i pulsanti, la UI è localizzata IT/EN e usa layout responsive mobile.

Il visualizzatore **non** conserva il JSON grezzo: `buildOfflinePublicAuditReview(unknown)` prima chiama `verifyPublicAuditFile`, poi copia con allowlist ciascun evento/frame/giocatore già controllato in nuove strutture read-only. Cambiando file il risultato precedente sparisce immediatamente, anche se il parsing è asincrono; un nuovo file malformato o oltre 64 KiB non lascia visibili vecchi eventi. Il componente non chiama la API, non aggiorna sessione/hand/live markers, non modifica URL o storage e non può impersonare un altro posto.

**Importante:** anche una sequenza di revisioni perfettamente coerente può essere costruita offline da un terzo, perché i file esportati rimangono **non firmati**. La timeline non prova la provenienza Edonism e non costituisce un replay autoritativo o una verifica delle regole future.

Regressioni: xUnit 2–8 player verifica gli stessi frame pubblici prima/dopo una mossa legale, con flag freeMoveUsed e strade corrette per ogni attore, senza token; Playwright UI 2/8 player naviga 0→1→0 in un secondo browser, rifiuta il file manomesso e nasconde la timeline, ripristina indice a 0 con file valido; scenario full round 0→N prova il saldo in attesa; Playwright live con API .NET confronta le posizioni esportate e navigabili senza bearer, senza modificare il match. Il gate rimane 3/3 suite verdi sull'esatto HEAD finale di `main`.

[Issue #70](https://github.com/KeyserDSoze/Game.Edonism/issues/70).


## Confronto di due export pubblici non firmati (#71)

Quando due giocatori condividono esportazioni `edonism-public-audit-v1` del medesimo match, il primo browser può verificare il JSON di ciascuna e compararne gli eventi/frame **alla medesima revisione pubblica**, senza token, login né rete. Dopo un primo import valido appare **Confronta due replay pubblici offline** / **Compare two offline public replays**: il secondo file è sempre trattato come non attendibile, con limite prelettura di **64 KiB** e verifica strutturale completa. Il programma conserva solo proiezioni whitelist degli eventi e delle posizioni, non dati sorgente con chiavi future.

Gli ID partita sono confrontati come GUID, **senza distinguere tra lettere esadecimali maiuscole e minuscole**, perché il verificatore v1 ammette entrambe le forme; una differenza di rappresentazione non crea una seconda partita.

Il confronto `compareOfflinePublicAuditReviews` confronta revisioni in ordine (inclusi attore, genere di evento, origine/destinazione, fase, turno, lista ordinata dei 2–8 giocatori, posizione e flag movimento). Gli esiti sono `identical` se tutte le revisioni coincidono, `left-prefix` se il primo è un prefisso esatto del secondo, `right-prefix` per l'inverso, `divergent` con la **prima** revisione discordante, e `different-match` per GUID differenti. Un file invalido, con dati privati extra o oltre il limite **non viene confrontato**. Sostituendo il primo file il confronto precedente sparisce immediatamente e viene invalidata qualsiasi vecchia lettura asincrona del secondo.

**Attenzione:** i due JSON sono **non firmati**. Possono essere entrambi coerenti e diversi perché almeno uno è falsificato, ma il software non può dimostrarne l'origine né attribuire responsabilità. Anche due file identici non provano un evento di server. Questa è una funzione Development di sola lettura; non autentica, non ripristina partite e non esegue comandi.

Test di valore: xUnit 2–8 seat conferma che la history pubblica è identica a tutti i posti e append-only da revisione 0 a 1; Playwright UI genera due export a r0/r1, li confronta su un secondo browser senza token, verifica fork falsificato ma singolarmente valido e id partita diverso, cancellazione dei risultati sui file invalidi e limite di byte; Playwright live confronta r0/r1 della reale API .NET e verifica che revisione, mano e autorizzazione restino invariati. 3/3 suite verdi sul commit finale `main` per chiudere #71.

[Issue #71](https://github.com/KeyserDSoze/Game.Edonism/issues/71).


## Regressione su import asincroni fuori ordine (#72)

La CI Playwright impone intenzionalmente un ordine avverso di completamento di `File.text()` nel pannello offline Development: un secondo file vecchio viene risolto **dopo** il file più recente; oppure il primo import è sostituito (valido o invalido) mentre la lettura del secondo è pendente. In tutti i casi il contatore di generazione impedisce il ritorno di confronti o timeline precedenti. Anche un secondo upload con campi sensibili extra o di oltre 64 KiB prevale su una lettura vecchia, rimanendo `invalid`. Gli scenari usano un JSON v1 pubblico e sintetico con due posti e i validatori reali del browser, senza API, bearer, storage o mutazioni di partita; la variante mobile verifica il testo inglese e il layout. Gli altri gate .NET/xUnit e Playwright live restano obbligatori per il commit finale. Nessuna firma o prova di autenticità è introdotta.

[Issue #72](https://github.com/KeyserDSoze/Game.Edonism/issues/72).
