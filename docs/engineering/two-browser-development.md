# Due browser, una partita Development — Issue #25

## Cosa cambia

Dopo #20–#24, il browser creatore della fixture poteva comandare i posti `alice` e `bob` da un unico pannello e leggere ogni mano scegliendo l'impersonazione. La #25 introduce una **seconda istanza React** in un browser/contesto separato, che entra nella medesima partita .NET con il **solo** token del posto autorizzato e si mantiene sincronizzata tramite un GET periodico.

Questo è un ambiente di test locale **Development-only**. Non è una lobby pubblica, non assegna identità verificata e non rende sicuri i token della fixture su Internet. I creatori continuano a ricevere tutte le credenziali, come dichiarato; #13 richiede ancora autenticazione reale, sessioni durevoli, revoca/token lifecycle, privacy multi-tenant e persistenza.

## Prova manuale

Avviare ASP.NET Core in Development su `127.0.0.1:5080` e React/Vite su `127.0.0.1:5173` (istruzioni nel README). Aprire due browser **con sessioni indipendenti**, non solo due tab che condividono le credenziali.

1. Nel browser A, cliccare **Avvia partita dimostrativa**. Leggere l'ID pubblico della partita nel pannello **Accessi locali alla partita**.
2. Premere **Copia accesso per bob**. Il browser copia negli appunti **due righe**: match ID e token segreto di bob. Trasferire queste due righe al browser B **solo durante il test locale**. Il clipboard è esplicito: non viene compilata alcuna query/URL.
3. Nel browser B, compilare **ID partita** e **Token privato del tuo posto**, poi **Entra come giocatore**. Il client legge `GET /api/dev/matches/{id}` e `GET /api/dev/matches/{id}/hand` usando il token nel solo header `X-Edonism-Dev-Token`; ricava il `playerId` **esclusivamente** dalla seconda risposta del server.
4. Il browser B ha ora **solo bob** come posto selezionabile e vede esclusivamente la sua mano. Non riceve mai il token di alice.
5. Nel browser A, muovere alice e terminare il turno. Entro il prossimo polling (circa 1,5 secondi, se la scheda è visibile) il browser B mostra la nuova revisione, lo spostamento sulla città 3D, il turno attivo, la cronologia pubblica, le attività controllate e la mossa consentita a bob.
6. Bob muove/termina dal browser B; il browser A osserva lo stato server senza ricaricare la pagina. Il round rimane `AwaitingRoundSettlement`: non si inventano automaticamente tasse, salari, carte o elezioni.

Un accesso con match ID inesistente, token malformato, assente o non corrispondente al match **non** stabilisce alcuna sessione e non rivela una mano privata. Il token fornito nel form viene cancellato dal campo dopo l'ingresso riuscito. La partita non sopravvive al riavvio dell'API: il `DevelopmentMatchStore` è in memoria.

## Sincronizzazione e gestione della concorrenza

Il client con sessione attiva esegue un `GET` autenticato ogni circa 1500ms, soltanto con scheda visibile. L'effetto React viene ripulito al cambio di match/token, all'unmount o alla chiusura. I comandi mutativi usano `expectedRevision` e il server decide se sono validi. Durante un comando locale, non vengono accettati snapshot in polling.

La revisione corrente viene protetta da un contatore monotono: un GET ritardato non può tornare a una revisione già superata né cambiare la posizione con uno stato obsoleto. Sui comandi 409 si esegue il recupero server già sviluppato in #20. Il browser non applica movimenti ottimistici e non trasmette coordinate 3D come regole.

Le mani private sono richieste **solo** nel contesto del token di posto. Il cambiamento dello snapshot pubblico non causa un cambio di mano verso un altro posto. La lista dei posti per una sessione entrata contiene **solo il proprio** posto, anche se il creatore originale disponeva di entrambi i token.

## Privacy e limiti

- Il token vive nello **stato effimero React**, non in localStorage/sessionStorage/cookie/URL. È un bearer token; chiunque lo copi può impersonare il posto **nell'ambiente Development**.
- I pulsanti di copia servono al debugging; la clipboard del sistema operativo è esterna al browser e va trattata come sensibile. Non inviare credenziali in log, screenshot o canali pubblici.
- L'ID partita non è una password. `playerId` non è un parametro di autenticazione. Il backend confronta il token con i segreti casuali a 256 bit mediante confronto costante e valida sempre turno e revisione prima di mutare.
- Non viene aggiunta **nessuna route Production**: il client Development rimane dietro `import.meta.env.DEV`, il server dietro `ASPNETCORE_ENVIRONMENT=Development`. Non avviare la modalità Development esposta su Internet.
- Il polling non è WebSocket/SSE e non dà consegna immediata o durabilità; non risolve eventi simultanei, reazioni istantanee o tempi della partita PvP.

## Test e verifica

`tests/backend/Edonism.Domain.Tests/DevelopmentMultiSeatEndpointTests.cs`: due client API indipendenti e token diversi per la stessa partita, mani disgiunte, rifiuto di comandi fuori turno e identità falsificata, revisione unica, privacy di snapshot/token/carte, token inventato e match sconosciuto.

`src/frontend/e2e/development-match.spec.ts`: test di ingresso per singolo posto derivato dalla mano server, invalid token, polling senza input locale, assenza di token da URL/storage/DOM, i18n EN, mobile e fallback WebGL.

`src/frontend/e2e-live/real-match.spec.ts`: scenario **senza HTTP mock** con due veri contesti Chromium indipendenti e API ASP.NET Core Development reale, che crea una partita nel browser A, entra come bob nel browser B, confronta carte private, sposta i giocatori, sincronizza le revisioni di entrambe le finestre e si arresta prima del settlement. I test precedenti rimangono nel gate CI completo.

Il risultato della CI finale va registrato nel ledger e nel commento di chiusura della #25. I test non dimostrano sicurezza Production (#13) né tutte le regole PvP (#4/#6/#8).

## Verifica finale della tranche

[GitHub Actions #42709228987](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42709228987), commit `adc536a`, **completed/success** con tutti i job verdi: **155/155 xUnit**, **24/24 Playwright UI mocked**, **5/5 Playwright live** con due browser e backend .NET reale. Il test del setup full-deck è stato corretto per usare la vera strada iniziale invece di ipotizzarla; il test di revision conflict verifica ora il **polling che aggiorna e disabilita** il pulsante, mentre i 409 continuano a essere esercitati direttamente via API e in Playwright mocked. Nessuna route Production è stata aggiunta.
