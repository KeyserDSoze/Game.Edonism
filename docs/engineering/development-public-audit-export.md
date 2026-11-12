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
