# Navigazione da evento pubblico a replay verificato e strada storica (#56)

## Scopo

Il gioco Development del primo round ha già un registro immutabile di eventi pubblici (`match-created`, `free-move`, `turn-ended`, `round-settlement-pending`), un replay verificato dal Domain .NET (#37), validazione completa dei frame nel client (#55) e un overlay read-only di posizione storica sulla città (#54). #56 collega questi elementi: un click su **Esplora / Inspect** a fianco di un evento apre esattamente la revisione del replay. Serve per analizzare rapidamente mosse degli altri giocatori senza simulare comandi.

## Contratti di sicurezza e stato LIVE

`DevelopmentMatchLab.jumpToAuditedEvent` verifica match ID, actor/seat/token attivi, revisione live e history lease; confronta l'evento scelto con lo snapshot pubblico originale e con lo stesso frame indicizzato. Questo `history` esiste soltanto dopo la verifica all-or-nothing di **tutti** i frame (#55). Gli eventi `free-move` devono indicare la stessa strada `toStreetId` della posizione dell'attore nel frame. Solo in quel caso la UI invia il consueto `HistoricalStreetFocus` alla scena. Gli altri tipi di evento spostano solo il cursore storico e annullano l'overlay; eventuali eventi futuri non riconosciuti vengono rifiutati.

Il salto non usa coordinate 3D per permessi, non aggiorna `onPublicState`, non cambia `TurnOptions`, non muove i Pucciottini LIVE, non effettua POST, non conosce mano/mazzo/fazioni e non mette token in URL/storage. Gli stessi reset per nuovo snapshot, cambio posto/token, revoca, uscita e selezione manuale della plancia continuano a essere applicati. Il validatore browser è difesa di visualizzazione, non sostituisce `.NET MatchAuditReplay` o l'autorizzazione del bearer.

## UX e regressioni

Il log pubblico continua a mostrare gli ID/revisioni originali. Ogni evento noto riceve un pulsante focusabile IT/EN con aria-label contestuale (per un movimento comunica anche il giocatore). `aria-current="step"` segnala la revisione ispezionata, senza confonderla con la revisione LIVE. Senza un history lease verificato il pulsante è disabilitato. La scena senza WebGL mostra comunque la scheda HTML storica; movimento storico e live restano distinti.

Test Playwright UI: genesis, movimento con tastiera in EN su mobile, ritorno al log, posizione LIVE e revisioni intatte, fine turno, saldo, replay manomesso, italiano senza WebGL. Test Playwright real-API: due browser isolati, giocatore remoto che analizza il movimento reale di un altro posto e continua a ricevere il live polling; private hand e comandi invariati. Il gate xUnit Domain resta obbligatorio insieme ai due job Playwright.

**Tracking**: [issue #56](https://github.com/KeyserDSoze/Game.Edonism/issues/56), [ledger](development-ledger.md). Si chiude soltanto dopo tutti e tre i job CI verdi sul medesimo commit finale di `main`.

Le regole ancora ambigue R-03/R-07/R-09/R-10, i costi e gli effetti delle carte, le elezioni e l'autenticazione Production restano nelle #4/#6/#7/#8/#13/#19.
