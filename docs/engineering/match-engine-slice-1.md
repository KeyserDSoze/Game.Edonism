# Match engine — prima verticale (issue #12)

**Stato:** prima slice *server-side*, **non una partita completa**. Provenienza: `rulebook2.zip` pp. 4–7 e `docs/game-design/rules-baseline.md`.

## Regole già coperte
- La plancia è definita in `src/shared/board/edonism-board.v1.json`; il giocatore si trova su una **strada**, non su un esagono né su un punto del renderer.
- Uno `StartingSlotId` dato dal **setup trusted** determina la sua strada iniziale; l'associazione fra personaggio, attività e carte deve essere completata in #6.
- Nella prima verticale ogni giocatore ha 4 atoms, 2 token Diplomazia, 16 scagnozzi (totale, non distribuiti) secondo il setup della stampa. Non sono assegnate carte o fazioni.
- L'attore del turno può chiedere **un solo movimento gratuito** verso una strada direttamente adiacente; non sono ancora presenti gli spostamenti pagati o abilità Speed.
- Le posizioni non arrivano dal client: l'intenzione contiene soltanto il codice della **strada di destinazione**, con validazione backend.
- L'ordine di giocata è quello della fixture iniziale; la funzione pura `RotateLastToFirst` rispecchia la regola «Gli ultimi saranno i primi».
- Dopo l'ultimo turno, lo stato è `AwaitingRoundSettlement` e **non** parte un round successivo: salario, tassazione, rifornimento, giorno elezione, rialzo scagnozzi e altre fasi sono ancora da sviluppare in #6.
- Ogni comando accettato crea un evento con tipo/attore/revisione; `ExpectedRevision` respinge richieste stale. Ogni errore lascia la revisione e lo stato immutati.

## Ambiente API

Le uniche rotte mutative del prototipo sono sotto `/api/dev/matches`, registrate esclusivamente in ambiente `Development`. Hanno stato in memoria e **non sono adatte a partite multiplayer pubbliche**. La creazione è un trusted **fixture** che consegna al creatore i token di tutti i giocatori: non equivale a login e non va esposta pubblicamente. I successivi comandi usano `X-Edonism-Dev-Token`, mai `playerId` nel body.

```http
POST /api/dev/matches/
Content-Type: application/json

{"players":[{"playerId":"alice","startingSlotId":"N-01"},{"playerId":"bob","startingSlotId":"S-01"}]}
```

La risposta contiene `matchId`, `state` e `credentials` per tutte le fixture. Conservare il token di alice, poi:

```http
POST /api/dev/matches/{matchId}/free-move
X-Edonism-Dev-Token: {token-di-alice}
Content-Type: application/json

{"destinationStreetId":"planck","expectedRevision":0}
```

```http
POST /api/dev/matches/{matchId}/end-turn
X-Edonism-Dev-Token: {token-di-alice}
Content-Type: application/json

{"expectedRevision":1}
```

`GET /api/dev/matches/{matchId}` con token restituisce lo stato attuale. Nessuna rotta `/api/dev/matches` esiste in ambiente `Production`. `GET /api/v1/board` continua ad essere pubblico, non mutativo.

## Debito tecnico esplicitamente aperto

1. #4/R-10: cinque connessioni delle strade sono state inferite da immagine; verificare prima delle partite live.
2. #6: setup con caratteri e carte obbligatorie, mani, economia, turno completo, salario, elezioni e reset successivo.
3. #7: carte, movimento aggiuntivo tramite scarto e Speed.
4. #13: autenticazione giocatori, JWT/OIDC o identità verificata, storage persistente, replay e audit durabile, sicurezza multi-client.

## Test
xUnit su invarianti/domain, adiacenze, turni, state revision, assenza mutazioni su errore; test integration `WebApplicationFactory` su capability per attore, spoofing, concurrency, assenza route in Production. Playwright resta come smoke della mappa per il browser.

## Verifica completata

[GitHub Actions main #42662175729](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42662175729): **53 test xUnit superati**, incluso test API Development/Production e collisioni `ExpectedRevision`; **5 test Playwright superati**; compilazioni .NET e frontend riuscite. Root cause dei primi due run rossi: test di uguaglianza di snapshot che confrontavano riferimenti alle collezioni, quindi corretto confrontando le proiezioni strutturali; sequenze `\\n` introdotte erroneamente nel file test e poi rimosse; analizzatore xUnit2031 con warning-as-error per `Assert.Single(Where(...))`, sostituito con l'overload filtrato.

Questa tranche è chiusa in #12. L'aggregato mantiene eventi in memoria, ma un **replay persistente** e l'audit multi-istanza restano per #13: non confondere la cronologia di prova con uno storage di produzione.
