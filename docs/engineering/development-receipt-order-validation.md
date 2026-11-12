# Unicità e ordine delle ricevute dei comandi PvP Development (#61)

## Problema

Le richieste `POST /api/dev/matches/{id}/free-move` e `/end-turn` possono portare l'header `Idempotency-Key` con UUID canonico. `DevelopmentMatchStore.TryExecute` registra una `DevCommandReceipt` **solo dopo il commit** per ogni comando riuscito con chiave. Una ricevuta indica attore, chiave, tipo, destinazione, revisione attesa e revisione accettata. Il receipt è persistito atomicamente nello stesso checkpoint privato AES-GCM e consente a un client che ha perso la risposta HTTP di ripetere senza doppio movimento/turno.

Il restore verificava ogni receipt singolarmente contro il registro pubblico e rifiutava doppie chiavi per lo stesso attore, ma non l'**unicità della revisione accettata** né l'ordine d'inserimento. Un file cifrato correttamente poteva contenere due UUID diversi che pretendevano di aver commesso **un unico evento**, o receipt riordinate, pur rispettando tutti gli altri controlli.

## Contratto applicato

- In `TryGetEntry` dopo le altre verifiche, le ricevute devono essere **strettamente crescenti** per `AcceptedRevision`. Il valore accettato è esattamente `ExpectedRevision + 1`, deve esistere nello snapshot e deve corrispondere a `ActorId`/tipo/destinazione originali. Nessuna coppia consecutiva deve avere `previous.AcceptedRevision >= current.AcceptedRevision`.
- `TryExecute` già appende in ordine solo una ricevuta dopo un comando realmente accettato. I retry con una chiave già vista non aggiungono ricevuta né evento e non riattivano gli observer/long-poll. **Le lacune sono lecite:** un comando senza UUID genera un evento ma non una ricevuta; i receipt più vecchi possono essere cancellati dalla retention.
- Gli UUID sono **scoped per actorId**, derivato dal bearer e non dalla query. Alice e Bob possono indipendentemente usare lo **stesso UUID**: i loro eventi hanno revisioni distinte e i due receipt sono legittimi. Non si impone unicità globale della chiave.
- Un file AES-GCM correttamente ri-cifrato ma con receipt falsificate è rifiutato **prima di rendere disponibile** una `Entry`: niente `TryRead`, `TryReadHand`, `TryBootstrapSeat`, `TryReadHistory` o `HasSeatAccess`. Il contenuto del token e degli action card non viene mai incluso nell'errore. Nessun cambio per le fixture v1 senza receipt o per il gameplay del primo round.

## Test e limiti

xUnit: due UUID differenti per la revisione 1 e receipt autentici in ordine invertito, con file rifatto usando le API AES-GCM, senza alterare event/actor/kind/revision dei singoli record; verifica il rifiuto pubblico/privato del nuovo store e la sopravvivenza dello store precedente. Per i player count 2–8, una free move con UUID e una serie di end turn senza chiave fino all'ultimo con **lo stesso UUID** dell'attore iniziale sono accettati, e retry dopo restart restituisce `idempotent_replay` senza mutazione. Playwright live: dopo aver perso la risposta al primo end-turn, Alice usa lo stesso UUID e riceve stato aggiornato; Bob può concludere il round con lo stesso UUID senza collisione globale; la mano di Bob rimane la propria e nessun evento aggiuntivo è appeso.

Questo è un controllo di **coerenza semantica** del checkpoint Development; non certifica la chiave AES-GCM contro un attaccante che può riscrivere l'intero stato, non realizza storage multiistanza o login Production (#13) e non determina nessun effetto di carte, elezione o economia (#4/#6).

[Issue #61](https://github.com/KeyserDSoze/Game.Edonism/issues/61) · [Ledger](development-ledger.md). La feature si chiude soltanto dopo xUnit, Playwright UI mocked e Playwright live .NET verdi sul medesimo HEAD finale di `main`.


## Risultato della prima CI completa

La [CI #43178125562](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43178125562) sul commit [`a00cc85`](https://github.com/KeyserDSoze/Game.Edonism/commit/a00cc8538caad9cc35b3fa6c84b56cc2101673f0) è risultata **3/3 success**: **422/422 xUnit (0 skipped), 97/97 Playwright UI e 30/30 Playwright live .NET, totale 549/549 test**. Sono coperti i file AES-GCM re-encrypted impossibili (receipt duplicate o invertite), i 2–8 attori con receipts lecite distanziate, UUID uguali fra posti diversi, retry dopo riavvio e retry browser dopo ACK persa senza doppio evento.

Durante la CI sono stati corretti **tre errori dei soli nuovi test**: annotazione nullable delle receipt, hardcode della strada iniziale non garantita nel fixture full deck e confronto diretto tra il comando `end-turn` e l'evento `turn-ended`. Le correzioni sono tracciate in #61 e non cambiano il contratto applicativo. La CI sul commit finale della documentazione e la chiusura vengono registrate nella stessa issue.
