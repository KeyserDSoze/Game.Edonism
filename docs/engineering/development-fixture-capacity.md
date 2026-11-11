# Capacità delle fixture Development — issue #48

## Obiettivo

La protezione #46 controlla il volume del body (128 KiB) e il tasso globale (64 POST creator/minuto), ma la finestra si rinnova: senza una seconda barriera una sequenza continua di richieste valide può far crescere le partite tenute in memoria. #48 pone un tetto process-local a **64 nuove fixture create** dalla stessa istanza `.NET` Development, senza cambiare alcuna regola o perdere sessioni esistenti.

## Contratto server

- Il contatore dei *nuovi* match viene aggiornato da `DevelopmentMatchStore.Register` **dopo** il salvataggio opzionale del checkpoint cifrato e la pubblicazione in-memory, sotto un solo lock di creazione. Una validazione di setup fallita, un errore di salvataggio o un fallimento prima della pubblicazione non consumano un posto.
- Al 65° match valido e per i successivi, ogni creator restituisce **HTTP 503**, `{"code":"dev_match_capacity_reached"}` con gli header centrali `Cache-Control: no-store`, `Pragma: no-cache`, `Expires: 0`. Non emette mai `credentials`, `state`, token o ID di una nuova partita.
- La priorità in pipeline rimane: body dichiarato >128 KiB → **413**; ammissione nella finestra 60s esaurita → **429**; body stream troppo grande → **413**; solo un body altrimenti valido passa alla capacità in-memory → **503** se piena. La quota di tentativi #46 si applica anche ai 503.
- Le **partite già create restano utilizzabili**, compresi bearer dei posti, mano privata, join atomico, audit, storia, long polling, movimento e fine turno. Nessuna eviction o cancellazione automatica, né endpoint di eliminazione accessibile a un normale token di giocatore.
- La UI React Development mostra un errore accessibile tradotto IT/EN e non installa uno stato di partita fantasma; la sessione esistente su un altro browser non viene alterata.
- Il conteggio è relativo alla vita del **processo**: un riavvio azzera gli slot per la modalità volatile (le fixture in RAM spariscono). Con checkpoint AES-GCM opzionali, i match storici possono essere ricaricati dal disco senza consumare slot di **nuova creazione** e senza revocare bearer preesistenti. Questa garanzia non fissa un massimo di partite ripristinate né di file cifrati: **non è una quota di storage o una policy Production.** L'uso oltre rete pubblica rimane proibito.

## Verifiche

- xUnit: 128 creazioni concorrenti ammettono esattamente 64 fixture univoche, tutte leggibili tramite i propri token, le restanti rifiutate; setup invalido non consuma posti; WebApplicationFactory con quota ridotta verifica 503 no-store e senza segreti su tutti e quattro i creator; letture e fine turno di vecchie partite restano autorizzate; Production non espone i creator.
- Le suite precedenti verificano anche checkpoint write rollback, 413 chunked, 429 e privacy di tutti gli status.
- Playwright mocked: test mobile in italiano e inglese per 503, nessuna sessione fantasma, retry dopo ripristino del backend mock. Playwright live .NET: nuova seconda fixture e join di un ospite non interrompono mano e stato del primo match. Non si saturano 64 fixture nel test live condiviso: potrebbe compromettere **tutti** gli altri test Playwright dell'istanza.
- Per la chiusura vedere l'esito **tre job CI verdi sullo stesso HEAD** nella [issue #48](https://github.com/KeyserDSoze/Game.Edonism/issues/48).

## Confini

Il limite non previene consumo dello storage su disco, crescita illimitata dei match ripristinati, abusi multi-processo, memory leaks fuori dal Dev store o accessi non autorizzati su Internet. Richiedono progettazione specifica e la futura identity/persistence Production [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13). Questa tranche non implementa economie, poteri o autorizzazioni PvP di produzione (#4/#6/#7/#8).
