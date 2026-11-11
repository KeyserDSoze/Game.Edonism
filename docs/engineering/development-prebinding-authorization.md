# Sicurezza dei comandi PvP Development: bearer prima del body — #45

## Bug di contratto e soluzione

Le Minimal API ASP.NET Core possono deserializzare un parametro di tipo `DevelopmentFreeMoveRequest` o `DevelopmentEndTurnRequest` prima dell'handler. Se il JSON non è valido, un utente senza bearer o con bearer revocato riceve una risposta `400`/ `415` senza che sia stata verificata la sua autorizzazione. La #40 garantisce che il parsing di `Idempotency-Key` avvenga dopo l'autorizzazione all'interno del comando; #45 estende la precedenza anche al model binding del body.

La route ha ora metadati tipizzati `DevelopmentCommandPreauthorization` solo nei due handler mutanti. `Program.cs` esegue `UseRouting` prima del filtro middleware Development; un endpoint marcato è autenticato usando `matchId` della route già validata e il token `X-Edonism-Dev-Token`, passando per `DevelopmentMatchStore.HasSeatAccess` che consulta il digest SHA-256 sotto il lock della partita. Risultato: senza credenziale valida, `404 {code:match_not_found}` prima di qualsiasi JSON parsing. Il middleware non legge body, non modifica revisioni, receipts, presenza, private hands, ETag o cronologia. L'handler non usa un playerId del payload come identità. Dopo il preflight, `TryExecute` **ri-autentica** nello stesso lock del commit, così una rotazione tra i due passaggi resta revocante (nessun bypass TOCTOU).

## Regressioni e limiti

Una credenziale valida conserva la semantica di binding di ASP.NET Core: `400` per JSON malformato o schema incompatibile, `415` per content type non JSON. Idempotenza UUID, opzioni Domain, revisioni monotone e 409 non cambiano. Tutte le risposte Dev (incluse quelle del middleware) hanno `Cache-Control: no-store`, `Pragma: no-cache`, `Expires: 0` (#33). Test xUnit parametrizzati con entrambi i comandi, bearer mancante/falso/revocato, body malformato/schema/contenuto, token ruotato, successo e audit non modificato. Playwright live usa due browser reali e richieste all'API .NET, verifica isolamento di sessione e aggiornamento avversario dopo un comando autentico.

Le quattro route creator non richiedono un bearer perché rilasciano *fixture* di Development soltanto: non vanno esposte in Production. Letture e `/api/v1` restano invariati. Questo **non** implementa login Production, JWT/OAuth, persistenza distribuita o rate-limit; sono requisiti separati della #13. Non cambia il regolamento (#4/#6).
