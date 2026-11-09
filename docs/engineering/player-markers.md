# Pucciottini dei giocatori — strade autoritative nella scena 3D (#22)

## Problema e fonte di verità

L'issue #5 ha ricostruito le **sette strade e trenta slot** della mappa stampata in `src/shared/board/edonism-board.v1.json`. La #12 espone il match Domain server-authoritative; la #20 connette React e i comandi `free-move`/`end-turn`; la #21 esegue Playwright **con backend reale**. Fino alla #22 le tre miniature erano solo decorative.

Ora il laboratorio Development passa dal backend soltanto la proiezione **pubblica** `[{ playerId, streetId }]` e `activePlayerId` allo stato di `App`. La proiezione passa a `playerMarkerPlacements` e poi a `CityScene`. **Nessun token, mano, mazzo o seed** è serializzato nella scena, nel roster o nell'URL. Il server decide gli `streetId`; il frontend **non** decide se un movimento sia valido.

## Algoritmo di sola rappresentazione

`src/frontend/src/features/city/playerMarkers.ts` ordina i giocatori per ID in modo deterministico e trova il primo rettangolo `roads` associato alla strada dal JSON canonico. Converte il centro della strada nelle coordinate di *rendering* usando `toScene`. Se più giocatori si trovano sulla stessa strada, li distribuisce lungo l'asse più lungo del rettangolo, limitando lo spacing all'estensione disponibile. Il risultato contiene `playerId/streetId/x/z/color/isActive`. La palette degli otto colori è una scelta **visiva**, non una fazione del regolamento. Il primo rettangolo di `main-square` si trova a nord di City Hall; nessun personaggio viene messo dentro al Municipio.

Una strada sconosciuta non riceve un fallback inventato: il suo segnaposto 3D/roster non viene creato. La mappa resta quella della #5, incluse le adiacenze inferite in attesa di validazione nella #4/R-10.

Nel Canvas, `PlayerPucciottino` usa le stesse primitive geometriche del personaggio illustrativo, con etichetta del player e anello per il turno attivo. Con match attivo i tre vecchi personaggi decorativi sono **nascosti**, non sommati ai giocatori; in modalità preview senza match rimangono visibili.

## Sincronizzazione e privacy

- `DevelopmentMatchLab` invia alla scena lo stato soltanto dopo la risposta JSON del backend su create, comando accettato o GET dopo conflitto `409`. Nessuna anticipazione ottimistica delle coordinate della mossa.
- `onStreetSelect` cambia solo la strada esplorata nel viewer. Selezionare un altro posto nel laboratorio non altera il roster o la posizione degli altri giocatori.
- La risposta di una mano passa esclusivamente nella UI privata del posto e **mai** allo stato `publicPlayers`.
- L'elenco sotto la scena mostra nome del posto, strada e stato di turno, con `data-street-id` testabile e `aria-live=polite`. È utilizzabile in modalità fallback WebGL e su dispositivi stretti.
- I colori/mesh sono segnaposto generati proceduralmente, non gli artwork definitivi dei Pucciottini (#9/#19). Questo non è un multiplayer pubblico: i token di Development non garantiscono le proprietà di Production (#13).

## Test e CI

I test Playwright mocked verificano comparsa dopo create, sincronizzazione con il movimento, cambio posto/strada senza spostamenti, due player nella stessa strada, ID sconosciuti senza fallback, vista accessibile senza WebGL e 409 senza movimento inventato. I Playwright **live** con API .NET reale confrontano gli attributi del roster con gli `streetId` restituiti dal backend, controllano movimento/turno, e riconciliano il turno evidenziato dopo un 409 causato da un altro client. Gli xUnit esistenti verificano direttamente le regole di spostamento e di revisione del Domain.

L'intera CI .NET/React/Playwright mocked+live deve rimanere verde su `main` prima della chiusura. I test automatizzati verificano la proiezione pubblica della posizione e il protocollo, **non** una qualità artistica finale dei modelli 3D.

## Fuori scope

Animazioni di percorso, collisions/pathfinding, spostamenti agli edifici controllati, modelli Pucciottini originali, combattimento, economia, cataloghi e sistema PvP Production. Non anticipa alcuna regola ancora da formalizzare nella #4.

## Esito finale della CI

[GitHub Actions #42697574711](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42697574711), commit `5c0c2d8`: `success` con tutti e tre i job completati. **131/131 xUnit**, **13/13 Playwright UI**, **3/3 Playwright live** con .NET 10 reale; build .NET senza warning/errori e bundle TypeScript/Vite riuscito. Sono inclusi i nuovi controlli di posizione, turni, fallback e 409. L'issue #22 è pronta alla chiusura, salvo regressioni nella CI dell'ultimo commit documentale.
