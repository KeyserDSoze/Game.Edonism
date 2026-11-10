# Trasporto idempotente dei comandi Development — issue #35

## Problema PvP

Con due browser, un click di `free-move` o `end-turn` può arrivare al server e modificare la partita mentre la risposta HTTP si perde. La validazione di `expectedRevision` impediva comunque una seconda mutazione, ma una nuova richiesta produceva `409` e il client non poteva distinguere se il proprio comando fosse stato eseguito. La #35 introduce un contratto di trasporto opzionale, che non definisce nuove azioni o regole della partita. La fonte della verità resta `GameMatch` e il suo audit deterministico.

## Richiesta e risposte

```http
POST /api/dev/matches/{matchId}/end-turn
Content-Type: application/json
X-Edonism-Dev-Token: <bearer-riservato-al-posto>
Idempotency-Key: 2b9271aa-61a9-4876-bddf-c5d4d44deead

{"expectedRevision":0}
```

`Idempotency-Key` è facoltativo e deve contenere un UUID non vuoto in forma canonica D, non un token di autenticazione. `free-move` usa la stessa intestazione, con `destinationStreetId` e `expectedRevision`. Non mettere le chiavi in query string o Web Storage.

- Prima invocazione valida: **200** con snapshot autoritativo e una sola transizione.
- Stessa partita, stesso attore autenticato, stesso UUID, comando, destinazione e revisione dopo che il primo è stato accettato: **200** con lo **snapshot attuale**, anche se altri turni sono avanzati nel frattempo. Nessun nuovo evento, revisione, effetto o segnale di long poll.
- Stessa chiave attore con payload differente: **409** `idempotency_key_reused`, senza esecuzione. Parametri non validi o stale con chiave nuova restano 409 secondo il Domain.
- Header malformato: **400** `invalid_idempotency_key`. Bearer non valido o revocato: **404**, anche conoscendo il vecchio UUID; il bearer nuovo dello stesso attore può recuperare una ricevuta salvata.
- Richieste senza header: comportamento originario con `expectedRevision`; ripetere dopo successo produce **409**. Non si registrano i comandi rifiutati.
- Su tutti gli esiti rimangono `Cache-Control: no-store`, `Pragma: no-cache` e `Expires: 0` (#33).

## Concorrenza, limiti e persistenza

Le ricevute appartengono a `(matchId, actorId, uuid)`, mai alla credenziale di accesso. L'attore viene derivato dal token **prima del lookup della ricevuta**. Il lookup, l'esecuzione e la registrazione avvengono sotto un solo lock per match. Anche 24 POST simultanei con la stessa chiave, nello stesso stato, accettano al massimo una mutazione; i successivi restituiscono lo stato corrente. La stessa UUID riutilizzata da Bob non riporta la ricevuta di Alice. La lista in memoria conserva solo le ultime **64** ricevute per match, per contenere l'uso di RAM e storage.

Le ricevute contengono soltanto `ActorId`, `Key`, `Kind`, `DestinationStreetId` (solo per `free-move`), `ExpectedRevision` e `AcceptedRevision`. **Non** contengono bearer, digest, mani, carte o i risultati segreti delle azioni. Le ricevute sono metadata del trasporto, non eventi del regolamento né parte del Domain.

Con checkpoint cifrati Development abilitati (#26), il file AES-GCM v2 contiene stato completo e registro delle ricevute nello **stesso save** prima della pubblicazione in memoria e della notifica ai subscriber (#34). Il write fail non rilascia una ricevuta falsa né una revisione non persistita. Il file v1 resta leggibile con registro vuoto e migra a v2 su una scrittura successiva. La validazione del restore controlla UUID, cardinalità, attore, revisione ed esistenza dell'evento di audit corrispondente, non soltanto l'autenticità del ciphertext.

Le ricevute più vecchie potrebbero essere eliminate. Se il client ripete un UUID eliminato, il controllo del Domain su `expectedRevision` respinge normalmente la richiesta con 409: non viene replicata una vecchia mossa. Il registro e i file sono **single-process Development**, non una garanzia di deduplicazione multi-instance Production.

## Browser React

`DevelopmentMatchLab` crea `crypto.randomUUID()` **una volta per intento utente**. Invio e retry riutilizzano invariati token, `expectedRevision`, corpo JSON e UUID. L'unico retry automatico avviene dopo un errore di trasporto della fetch, non dopo un errore HTTP 5xx o 409/404; non si riprova dopo cambio match, attore, token o revisione confermata. Il client può applicare esclusivamente uno snapshot autorizzato del server, mai incrementare autonomamente la revisione o modificare la posizione della pedina.

Nei test Playwright reali viene inoltrata la prima richiesta a .NET e soltanto la risposta viene eliminata, simulando un ACK perso: la seconda richiesta con lo stesso UUID ottiene 200 e sul server esiste **un solo** evento `turn-ended`.

## Verifiche e vincoli

xUnit HTTP copre primo comando/retry, stesso UUID con payload differente, 24 concorrenti, un altro attore con identico UUID, rotazione del token, key invalida, API disabilitate in Production, client legacy senza chiave, idempotenza `free-move` e audit immutato. Test xUnit sul checkpoint cifrato coprono restart, replay post-restart, rollback I/O, migrazione v1→v2 e ricevuta falsificata non corrispondente ad alcun evento. Playwright mocked controlla la ripetizione dell'UUID dopo rete fallita e l'assenza di retry su 503; Playwright live prova la vera API e l'assenza di segreti negli storage del browser.

Rimane fuori: riconciliazione delle azioni delle carte, multi-instance Production, identity/account, persistenza DB, settlement e regole non ancora approvate #4/#6/#13. Le ricevute in Development **non** sostituiscono il ledger di eventi o la futura infrastruttura Production.

Tracking: [issue #35](https://github.com/KeyserDSoze/Game.Edonism/issues/35), [ledger](development-ledger.md). Chiudere solo dopo xUnit, Playwright UI e Playwright live verdi sul commit HEAD di `main`.
