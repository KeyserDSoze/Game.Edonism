# Game engine: setup seeded delle 30 attività (#16)

**Fonte primaria:** `rulebook2.zip`, pagine 3–4. La plancia stampata comprende 30 attività estratte dalle 46 disponibili, rispettando otto categorie e conservando le carte iniziali associate ai personaggi. Questa implementazione **non contiene il catalogo autentico né il mazzo dei personaggi**.

## Algoritmo

1. `ActivitySetupComposer.Compose(board, catalog, mandatoryCardIds, seed)` riceve un catalogo tipizzato con **esattamente 46 identificativi distinti**, le carte obbligatorie del setup server e un seed intero.
2. Verifica categorie/identificativi validi, obbligatorie presenti e quote stampate: **5 public-financing, 5 private-financing, 4 black-market, 4 corruption, 4 culture, 2 sport, 3 transport, 3 bishopric**.
3. Mantiene tutte le carte obbligatorie, completa le categorie tramite Fisher–Yates su liste ordinate per ID e RNG `xorshift32`. Il risultato è riproducibile per input equivalenti e stesso seed; versione algoritmo `activity-setup-v1-xorshift32`.
4. Passa le 30 attività a `ActivityPlacement.Assign` per distribuirle negli slot originali con seed di posizionamento derivato da `seed XOR 0x6D2B79F5`.
5. `GameMatch.CreateFromTrustedCardSetup` trova lo slot di ogni starting card del personaggio e ricava la sua **strada iniziale** e lo scagnozzo in piedi sul lotto, senza accettare posizione/ownership dal client. I 30 `boardActivities` sono visibili nello snapshot; non includono carte segrete o mani.

## Regole non inventate

`rulebook2.zip` p.4 descrive come togliere le carte **non iniziali** in eccesso di colore; non chiarisce una soluzione univoca quando le **sole carte obbligatorie** superano la quota. Il codice **rifiuta** questa configurazione: decisione ancora aperta [#4/R-03](../game-design/open-questions.md). Rifiuta anche cataloghi insufficienti e carte obbligatorie ignote/duplicate, senza sostituzioni arbitrarie.

I 46 identificativi usati dai test (`sport:01`, ecc.) sono **sintetici**, non rappresentano carte stampate. Le illustrazioni, i costi, i personaggi e gli effetti reali sono ancora da importare e validare nelle issue #7/#9.

## API solo Development

`POST /api/dev/matches/from-cards` riceve:
- `players`: `[{ "playerId": "alice", "startingCardId": "sport:01" }, ...]`
- `availableActivities`: **46 elementi** `{ "id": "sport:01", "category": "sport" }` con otto categorie e quote sufficienti
- `seed`: intero, per esempio `2026`

Restituisce il normale fixture `matchId/state/credentials` del server, compresi `boardActivities` e gli scagnozzi iniziali. I normali `free-move/end-turn` richiedono il token della specifica pedina e `expectedRevision`; il server continua a validare il grafo delle strade. Le credenziali di **tutti** i partecipanti sono restituite al creatore del fixture: **non esporre Development su Internet**. In `Production` questa route non esiste; l'identità multiplayer e lo storage sono tracciati in #13.

## Test

`ActivitySetupComposerTests`, `CardSetupMatchTests`, `DevelopmentCardSetupEndpointTests` verificano quote, obbligatorie, invarianti, duplicati, insufficienza, overflow non definito, ordinamenti e seed, starting card → slot → strada e route non disponibile in Production. [CI #42676164483](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42676164483): **86/86 xUnit** (0 warning, 0 errori) e **5/5 Playwright**, build .NET/React riuscite.

La #6 rimane aperta: mancano le carte autentiche, il setup completo, i turni con carte, il salario effettivo e le elezioni. Le adiacenze inferite della mappa restano da approvare in #4 prima delle partite reali.
