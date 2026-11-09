# Audit pubblico verificabile del primo round — #24

## Perché questa tranche

Il `GameMatch` server-authoritative di #12 emette da tempo una traccia pubblica, ma mancava una verifica indipendente che quella traccia riproducesse posizione e turno realmente restituiti dalla partita. Questa tranche è una **base tecnica per auditing e persistenza futura** (#13): **non** è event sourcing persistente, non rigioca carte, non ricostruisce i mazzi e non sblocca la risoluzione del round (#6).

**Fonti di regola:** `rulebook2.zip` pp. 5–7 per movimento gratuito, ordine dei giocatori e rotazione proposta. La risoluzione di salario netto, pesca/rifornimento, elezioni e dichiarazione carte rimane bloccata dalle questioni #4/R-07/R-09. La rotazione è **solo proposta**: il match termina su `AwaitingRoundSettlement` e non avvia un nuovo round.

## Verificatore Domain

`MatchAuditReplay.Verify(BoardDefinition, MatchSnapshot)` è una funzione pura, senza accesso HTTP/DB o dipendenza dal renderer. `GameMatch.VerifyPublicAudit()` passa la propria board canonica e lo snapshot corrente al verificatore. La base della ricostruzione sono **gli slot iniziali pubblici validati** da `StartingSlotId` e la traccia `Events` (non le coordinate client). Il verificatore:

1. Richiede version board concorde, match valido da 2–8 giocatori con identità/slot iniziali distinti, ordine del turno coerente e lista `ProposedNextRoundOrder` uguale alla rotazione già calcolata dal Domain.
2. Richiede il solo evento di genesi `match-created` a revisione **0**, round 1, attore `system`, senza origine/destinazione.
3. Rigioca gli eventi con revisioni sequenziali senza buchi, sempre nel **primo round** e con l'attore effettivamente di turno:
   - `free-move` — una volta soltanto per attore, origine pari alla posizione ricostruita, destinazione su strada adiacente nella board canonica;
   - `turn-ended` — solo prima dell'ultimo giocatore, prosegue al successivo, senza dati strada;
   - `round-settlement-pending` — solo dall'ultimo giocatore, porta a `AwaitingRoundSettlement`, senza continuare con altri eventi.
4. Rifiuta qualsiasi altro tipo di evento (fail-closed) finché non avrà una semantica approvata. Verifica poi corrispondenza con revisione, fase, giocatore attivo, strada e `FreeMoveUsed` dello snapshot.
5. Restituisce `MatchAuditReplayResult` con `isValid`, codice deterministico, revisione verificata, fase/attore e sola lista pubblica di posizioni ricostruite.

Il verificatore **non** convalida portafogli, risorse, carte/azioni, scagnozzi, effetti, fazioni, salario o progresso economico: il suo nome completo e i documenti devono continuare a precisare che la prova riguarda **solo** movimento/turno del primo round. Non esiste ripristino della partita dal solo log. In particolare gli eventi emessi non contengono i parametri di setup o il mazzo privato necessari per restaurare una partita reale.

## Endpoint Development e confine di privacy

`GET /api/dev/matches/{matchId}/audit` richiede `X-Edonism-Dev-Token` valido del posto. Come le altre route della fixture, restituisce **404** per match/token assenti o errati e non viene registrata in Production. Il query parameter `playerId` non determina alcuna identità. Restituisce soltanto la verifica del replay **pubblico**, non carte in mano, token, pile o identità private. La fixture Development continua però a restituire al creator le credenziali di **tutti** i giocatori: non è un sistema di login PvP sicuro su Internet e non sostituisce #13.

## React e lista accessibile

Il pannello `DevelopmentMatchLab` ora mostra **Registro pubblico del round**, riproducendo solo i quattro `kind` attualmente ammessi del `MatchSnapshot.Events`. `publicAudit.ts` applica una whitelist preventiva: revisioni e round validi, attore conosciuto, origine e destinazione di una mossa appartenenti a strade note. Gli eventuali tipi evento futuri sconosciuti **non** vengono visualizzati, perché potrebbero contenere informazioni private non ancora classificate. Questa whitelist UI è un filtro di presentazione, **non** il verificatore Domain.

L'ordine del round successivo proviene dal campo pubblico `proposedNextRoundOrder` del backend ed è marcato esplicitamente **non eseguito**. La UI non inventa cambi turno né eventi: riceve una nuova cronologia soltanto su setup o comando accettato; in caso di HTTP 409 ricarica lo snapshot autoritativo. Se il giocatore passa da `alice` a `bob` nell'ambiente di prova, la cronologia non cambia. Il registro DOM è accessibile anche senza WebGL, usa IT/EN e rimane utilizzabile da mobile.

## Test e limiti

- **xUnit Domain:** 2–8 partecipanti e stati intermedi, movimenti validi, eventi alterati (revisione, round, origine, destinazione, attore, evento sconosciuto), mossa gratuita ripetuta, fine round prematura o duplicata, snapshot alterato e comandi respinti senza eventi; verifica che carte private e mazzo non arrivino nel risultato.
- **xUnit HTTP:** endpoint protetto da token, status 404 per credenziali errate o assenti, nessun `playerId` in input fidato, non registrato in Production e nessun ID mano nelle risposte.
- **Playwright UI:** visualizzazione cronologica dopo comandi, solo eventi pubblici in whitelist, anteprima dell'ordine, aggiornamento 409 senza evento ipotetico e modalità EN senza WebGL.
- **Playwright live:** browser React/Vite collegato all'API ASP.NET Core Development reale; verifica cronologia/ordine nel DOM contro `MatchSnapshot` ed endpoint di replay autenticato, senza mock HTTP.

La CI completa deve superare i job xUnit, Playwright UI e Playwright live su `main` prima che #24 sia chiusa. La fonte normativa resta il regolamento stampato e le decisioni ancora da approvare sono tracciate nella #4. L'engine e il multiplayer Production restano nelle #6 e #13.

## Verifica finale CI

[GitHub Actions #42705247221](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42705247221) su commit `b1c9671`: `completed/success` per tutti e tre i job, **153/153 xUnit**, **20/20 Playwright UI**, **4/4 Playwright live** collegati all'API .NET reale. Build .NET 10 con 0 errori e 0 warning, TypeScript/Vite verde. Il nuovo audit non autorizza il secondo round, non convalida l'economia e non riabilita in Production le route Development.
