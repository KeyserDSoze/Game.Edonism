# Match engine — mazzo azioni e mani iniziali private (#18)

**Fonte stampata:** `rulebook2.zip`, **pagina 3**: 58 carte azione e 1 carta distinta «Giorno dell'elezione». **Pagina 4**: mescolarle **insieme** e distribuire **quattro carte a ciascun giocatore**. **Pagina 5**: la dichiarazione del numero di carte e il rifornimento successivo sono fasi diverse, non parte di questa tranche.

## Implementazione

- `InitialActionDeckComposer.Deal` (Domain) valida **58 identificativi d'azione univoci**, non vuoti, più l'ID unico della carta Giorno dell'elezione e 2–8 giocatori univoci per la fixture Development.
- Versione algoritmo `initial-actions-v1-xorshift32`: ordina gli ID, mescola tutte **59** le carte con Fisher–Yates + xorshift32 e distribuisce esattamente **4** carte per partecipante, senza reinserimento. Le restanti `59 - 4 * N` carte restano nella pila ordinata e **privata del server**. Il seed è un artificio di riproducibilità per test, non una modifica delle regole al tavolo.
- Non separa artificialmente la carta Giorno dell'elezione: mescolandola insieme alle 58, **potrebbe comparire in una delle mani iniziali**. Questo è coerente con l'istruzione di mischiatura a pagina 4, **ma il comportamento elettorale conseguente resta una domanda aperta** `#4/R-09`: non si avviano elezioni automatiche, non si scarta la carta e non si impone un nuovo reroll.
- `GameMatch.CreateFromTrustedFullDeckSetup` combina la pesca personaggi (#17), le 46→30 attività (#16) e il mazzo azioni (#18). Le attività iniziali, la vita e la strada vengono sempre determinate sul server; gli effetti delle carte azione non sono ancora disponibili.
- I normali `MatchSnapshot` restano proiezioni **pubbliche**: nessun ID di carta azione, mano o pila rimanente viene serializzato. `MatchPrivateHandSnapshot` contiene soltanto le **4 carte del giocatore autenticato**, ottenute internamente tramite `GameMatch.PrivateHandForActor`.

## API di test protetta (solo Development)

`POST /api/dev/matches/from-full-deck` accetta `playerIds`, `characters` (23 schede tipizzate), `availableActivities` (46 carte), `actionCardIds` (**58** ID unici), `electionDayCardId` (ID distinto) e `seed`. Lo schema dei primi campi è documentato nelle tranche #16 e #17. **I cataloghi ufficiali non sono stati importati**: in test usiamo unicamente ID sintetici, mai il contenuto reale delle carte.

La risposta del creator contiene solo `matchId`, lo snapshot **pubblico** e le **credenziali di sviluppo** dei giocatori. **Non** contiene mani né draw pile.

`GET /api/dev/matches/{matchId}/hand` richiede `X-Edonism-Dev-Token` e restituisce soltanto:

```json
{
  "matchId": "00000000-0000-0000-0000-000000000000",
  "playerId": "alice",
  "cardIds": ["test:action:01", "test:action:11", "test:action:21", "test:action:31"]
}
```

I valori sono un **esempio artificiale della forma della risposta**, non un risultato attribuito a un seed reale. Il client non può indicare `playerId` per leggere la mano avversaria. Le credenziali di **tutti i giocatori** vengono ancora restituite al creator della fixture: `Development` **non** è sicuro per una partita su Internet.

Un token mancante/errato o una partita senza action deck restituisce **404**. Le route non vengono registrate in **Production**. La #13 deve implementare autenticazione reale, segregazione dati, persistenza e riconnessione prima del PvP pubblico.

## Non implementato / limiti

- I 58 PNG originali, i costi, le icone @/#, gli effetti delle singole azioni e la carta Giorno elezione originale: acquisizione #19 e catalogo/poteri #7/#9.
- Dichiarazione di quante carte restano in mano, gioco/scarto/contrapposizione di carte, cassaforte, rifornimento, attivazione della carta elezione, voti e salario/tasse: issue parent #6 e quesiti #4/R-07/R-09.
- Nessun ID di carta d'azione è aggiunto agli audit event pubblici e nessun comando può cambiare una mano. Le mani rimangono immobili dopo il setup per ora; **non** dichiarare il round o il gioco operativo.
- Non c'è autorità nel browser: soltanto il backend conserva la pila e autorizza l'accesso alla mano privata.

## Test di accettazione

`InitialActionDeckComposerTests`: conteggio **59**, 4 a giocatore, 27–51 carte residue nelle fixture da 8 a 2 giocatori, unicità, seed riproducibile, ingresso indipendente, possibilità della carta elezione nella mano, validazione, collezioni read-only.

`MatchPrivateHandsTests`: nessun ID d'azione in `MatchSnapshot` serializzato, solo la mano dell'attore, immutabilità, compatibilità fixture legacy, nessuna mutazione da `TryFreeMove/TryEndTurn`.

`DevelopmentPrivateHandEndpointTests`: due token distinti, un attore non può ottenere la mano avversaria anche con `playerId` nella query, pubblico senza carte, nessun accesso con token errato, assenza route Production, rifiuto 58 carte incomplete. Playwright è smoke di regressione della UI della mappa e non pretende un card viewer completo.

L'esito e il link della CI finale saranno registrati nella #18 e nel development ledger prima di chiuderla.
