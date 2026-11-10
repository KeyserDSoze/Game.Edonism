# Checkpoint privato della partita e storage Development cifrato — #26

## Scopo e confini

Questa tranche realizza un **ripristino completo dello stato attualmente supportato** (primo round, movimento gratuito, fine turno) e delle **mani private e del mazzo residuo**. Estende #24, dove l'audit pubblico poteva verificare la cronologia ma **non** ripristinare il mazzo; estende #25, dove due browser potevano giocare ma il match spariva dopo il riavvio dell'API.

**Non è un servizio PvP di produzione**: niente login, identità verificata, revoca token, database transazionale distribuito, multi-processo, GDPR/data retention, rotazione delle chiavi, politiche di backup né altri round. La parent [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13) rimane aperta. Nessuna route di gestione partite è registrata in Production.

## Avvio locale sicuro (esplicitamente opt-in)

Senza configurazione la fixture Development mantiene lo **store volatile** precedente. Per abilitare la persistenza in un **singolo processo** ASP.NET Core Development, impostare entrambe le variabili **fuori dal repository**, su una macchina di test privata:

```bash
# Esempio Linux/macOS. Scegliere una cartella assoluta fuori dal repo.
export EDONISM_DEV_CHECKPOINT_DIR="$HOME/.local/share/edonism/dev-matches"
export EDONISM_DEV_CHECKPOINT_KEY_HEX="$(openssl rand -hex 32)"

ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://127.0.0.1:5080 \
  dotnet run --no-launch-profile --project src/backend/applications/Edonism.Api
```

La chiave è un segreto **AES-256 (32 byte / 64 caratteri esadecimali)**. **Conservarla in un gestore di segreti esterno**, mai nella repository, in una query URL, in log, in file `.env` committati o nella documentazione. **Per riprendere la partita dopo il riavvio bisogna reimpostare esattamente la stessa chiave e directory**; generarne una nuova rende i vecchi checkpoint illeggibili. Con una sola delle variabili valorizzata il processo fallisce all'avvio (fail closed).

Una partita creata con la fixture / due browser #25 continuerà ad accettare **gli stessi token di posto** dopo il riavvio del backend, purché il browser abbia ancora il token nella sessione effimera (o esso sia custodito esternamente e reinserito manualmente). La propria mano resta segreta rispetto agli altri token. Il browser non salva i token in localStorage/sessionStorage/URL. Il riavvio dell'API non ricrea la sessione browser dopo un refresh completo: il token va reintrodotto tramite il form Development.

## Dati del checkpoint interno

`GameMatch.CaptureCheckpoint()` crea `GameMatchCheckpoint` **versione 1** contenente:

- `MatchSnapshot` completo, ancora la sola proiezione **pubblica**: player, posizioni, risorse iniziali, lotti/attività controllate, quotes lorde, 30 attività faccia in su, personaggi assegnati, ordine e audit.
- `InitialActionDeal` **privato**, con 4 carte per ogni posto, lista della pila residua, seed e versione dello shuffle. Il checkpoint non viene mai ritornato da endpoint HTTP.

`GameMatch.RestoreFromCheckpoint(board, checkpoint)` fa una verifica indipendente prima di pubblicare un nuovo aggregate: versione schema, board, slot/owner/henchmen, risorse correnti, carte pubblico uniche, personaggi coerenti con lotto/cuori, esattamente 59 action/Election Day senza duplicati, salari **lordi** ricalcolati e `MatchAuditReplay.Verify` per ogni mossa/turno/revisione del primo round. Nessun replay di poteri/economia né avanzamento automatico oltre `AwaitingRoundSettlement`.

## File cifrati e commit atomico

`DevelopmentMatchCheckpointFiles` è un adapter **solo Dev**, privo di route. Scrive `<match-id-n>.edonism` nella directory dedicata. Ogni aggiornamento serializza il checkpoint interno e un dizionario di **SHA-256 degli originali token bearer casuali a 256 bit**, *non* gli originali. Tutto il payload (inclusi hash, carte e pile) è cifrato con **AES-256-GCM**, nonce casuale di 96 bit, tag autenticato di 128 bit, e `matchId` come associated data: un file copiato/alterato o aperto con la chiave sbagliata non viene caricato. I file temporanei contengono **solo ciphertext**, vengono scritti e flushati prima di un rename nella stessa directory; su Unix directory e file sono limitati ai permessi dell'utente.

Lo store Development salva **prima** di esporre una nuova partita oppure una mutazione accettata. Per i comandi utilizza un aggregate clone: se scrittura o cifratura fallisce, la mutazione non diventa visibile in memoria. Le letture da un nuovo processo ricostruiscono lazy lo stato validato sul file e poi verificano i token tramite confronto a tempo costante dei digest. L'audit corrente continua a funzionare anche dopo il ripristino.

### Limiti da rispettare

- Singolo processo/single writer su filesystem locale; **non** avviare due server sullo stesso percorso. L'operazione di rename non coordina istanze multiple e non sostituisce un database transazionale.
- File cifrato ≠ sicurezza completa di un sistema pubblicamente esposto: il processo conserva la chiave e i token arrivano su HTTP locale; TLS, autenticazione reale, sessioni durevoli, scadenza/revoca, DB, backup, osservabilità e controllo privilegi restano #13.
- Una chiave errata o un file corrotto falliscono **chiuso**: il match non viene letto e i segreti non sono restituiti. Non esiste un ripristino magico/automatico senza la chiave. Non eliminare file di cui serve conservazione senza una procedura di backup.
- L'opzione è volutamente **inattiva di default**; la CI live usa ancora il normale processo Development volatile, per evitare segreti persistiti nei runner.

## Verifiche

`MatchCheckpointTests` (xUnit) copre restore della fixture con deck 59 carte, ricostruzione di posizioni/turni e successivi comandi, mani disgiunte, assenza di segreti nello snapshot pubblico, copia profonda e rifiuto di schema/board/eventi/risorse/owner/deck alterati.

`DevelopmentCheckpointPersistenceTests` (xUnit + WebApplicationFactory) copre due store distinti e due istanze HTTP Development per simulare il riavvio dell'API, persistenza del turno e del deck, token differenti per posto, richiesta senza token, ciphertext non leggibile, chiave sbagliata, manipolazione del file e fallimento della scrittura senza variazioni allo stato in memoria.

I job CI conservano Playwright UI e Playwright live (inclusi **due browser indipendenti** contro la stessa API reale): senza nuova UI/nuove route, la compatibilità di tutti i flussi è un requisito di regressione. La verifica finale si trova nell'issue #26 e nel development ledger.

## Riferimenti

- [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13) — autenticazione, sessioni persistenti Production e storage
- [#24](match-audit-replay.md) — verificatore del solo registro pubblico del primo round
- [#25](two-browser-development.md) — ingresso da un secondo browser, token effimeri
- [#4](../game-design/open-questions.md) — regole ancora da validare; il checkpoint non le anticipa

## Risultato verificato su `main`

[CI #42712968317](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42712968317), commit `1733823`: **165/165 xUnit .NET 10**, **24/24 Playwright UI**, **5/5 Playwright live**, tre job `success`, build .NET 10 con **0 warning e 0 errori**. Questa esecuzione include anche README, AGENTS, la guida di sicurezza e la configurazione di opt-in; non abilita alcuna nuova route Production. La parent #13 resta aperta.

## Rotazione del bearer di posto (#28)

La [rotazione Development](development-seat-rotation.md) sostituisce un solo token di posto alla volta, scrivendo il nuovo digest cifrato *prima* della revoca in memoria. La revisione del gioco e il checkpoint delle carte non cambiano. Non si possono recuperare vecchi token o ottenere un nuovo token senza essere già in possesso di quello corrente. Il creator non riceve in automatico i token ruotati da altri browser. L'endpoint non esiste in Production.

## Ricevute di comandi idempotenti (formato cifrato v2, #35)

Il formato del **payload cifrato** passa da v1 a v2, mantenendo lo stesso envelope AES-256-GCM `EDONDM01`. Il payload v2 contiene `CommandReceipts`: massimo 64 ricevute di trasporto per match, senza token o carte. `DevelopmentMatchStore` salva la ricevuta e il `GameMatchCheckpoint` dell'azione accettata in un'unica operazione di cifratura + atomic rename, poi aggiorna lo stato in memoria e notifica il long polling. Un fallimento del file system non pubblica né evento né ricevuta.

I file v1 esistenti restano leggibili; non contengono ricevute e vengono migrati automaticamente a v2 al primo comando accettato o rotazione token. Sul restore, le ricevute v2 sono validate contro il log eventi pubblico (UUID canonico, attore valido, tipo, destinazione, `ExpectedRevision + 1 = AcceptedRevision`, evento audit corrispondente e nessun duplicato per attore + UUID). Una ricevuta inconsistente impedisce il caricamento del match. Il `GameMatchCheckpoint` del Domain **resta v1**: non viene modificata alcuna fase o regola di gioco.
