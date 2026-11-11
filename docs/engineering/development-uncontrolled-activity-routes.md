# Edonism — percorsi verso attività non controllate (PvP Development #49)

## Contesto

Il primo round esistente conserva una plancia con 30 attività pubbliche, proprietà iniziali server-associate, posizioni dei 2–8 attori e il grafo con sette strade. La stampa descrive la necessità di stare sulla stessa strada di un'attività per un possibile acquisto, ma il catalogo dei costi non è completo (#19) e le regole del motore #6 sono in revisione (#4/R-07/R-10). Questa funzionalità **non compra**, **non stima turni** e non riserva risorse. Mostra semplicemente le distanze di grafo agli slot con carte non controllate. L'arco equivale a una connessione tra strade (0 = stessa strada); non rappresenta automaticamente una mossa gratuita o un turno.

## Domain: proiezione verificata e deterministica

`GameMatch.VerifiedUncontrolledRoutesForActor(actorId)` usa il giocatore server-side, verifica il match con `MatchAuditReplay.Verify` alla stessa revisione e legge solo `BoardActivities` e `ControlledActivities`. Esclude ogni slot controllato, associa lo slot alla strada canonica e chiama `BoardDefinition.ShortestStreetDistance` (BFS con adiacenze reciproche). Ordina per `StreetSteps` crescente e `SlotId` ordinal, restituendo un array immutabile. Le fixture trust-seeded senza catalogo pubblico producono lista vuota; un attore ignoto non riceve proiezione.

La risposta pubblica include solo `matchId`, `playerId`, `round`, `verifiedRevision`, `fromStreetId`, `routes[]` (slotId, cardId, category, streetId, streetSteps). Tutti gli ID carta sono **già pubblici sulla plancia**. Non sono restituiti `actionCardIds` di mano, mazzo, token, faction, wallet, costo, ownership futura o diritti di acquisto. Nessun evento, revision increment, heartbeat, checkpoint o receipt viene scritto dalla lettura.

## API, browser e privacy

In Development soltanto: `GET /api/dev/matches/{matchId}/uncontrolled-routes`. `DevelopmentMatchStore` verifica il bearer `X-Edonism-Dev-Token` **sotto lock** prima di eseguire il calcolo; token assente/falso/revocato -> 404. Risposta 200/404 e altri errori sotto `/api/dev/matches` usano `Cache-Control: no-store` (policy #33). Nessun endpoint in Production, nessun `playerId` attendibile nella query.

Il client richiede la proiezione quando cambia match, revisione, attore o token, abortisce la richiesta precedente e visualizza **solo** se la risposta concorda con la revisione e la credenziale corrente. Confronta ogni slot e carta contro lo snapshot pubblico corrente, assicura che non sia controllato, verifica la strada del tabellone, distanza intera da 0 a 6 e ordine deterministico; una risposta tardiva o malformata non appare. Mostra al massimo 5 delle attività più vicine, il totale, e un messaggio IT/EN in un pannello accessibile. Le distanze non abilitano nuove mosse; `turn-options` e le API comando restano l'unica autorità. Lo stato della città 3D non viene guidato da questa vista.

## Test e confini

xUnit: 2/4/8 giocatori, tutte le 30 carte pubbliche meno quelle controllate, BFS su board canonicale, stesso slot=0, movimento, fine primo round, checkpoint, array immutabili, assenza di mano; WebApplicationFactory per query `playerId` falsificato, 404/no-store/rotazione e Production. Playwright mocked: IT/EN, mobile, switch seat, risposte ritardate e revisione errata. Playwright con vera API .NET: due browser con mani private, distanze/autorizzazione prima/dopo uno spostamento e assenza di nuove mutazioni.

Il grafo `edonism-streets-v1` contiene archi ricostruiti dalla plancia; rimane la verifica R-10 con il game designer. I prezzi, gli acquisti, le carte e le fasi successive non sono introdotti e seguono #4/#6/#7/#19.

Tracking: [#49](https://github.com/KeyserDSoze/Game.Edonism/issues/49).

## Verifica codice e browser

La [CI #43048278643](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43048278643) ha passato **296 xUnit, 69 Playwright UI e 28 Playwright full-stack reali** (393/393, tre job verdi). Il gate documentale finale viene registrato sulla issue #49.

## Percorso stradale minimo esplicito — #50

Ogni attività conserva `streetSteps` ed espone ora anche `streetPath`: lista **inclusiva** della strada corrente del giocatore e della strada della carta. Il Domain calcola il percorso con BFS su `BoardDefinition.ShortestStreetPath`, esplorando i vicini in ordine ordinal di ID per rendere deterministici gli ex aequo; `ShortestStreetDistance` deriva dal percorso, dunque `streetSteps = streetPath.Count - 1`. Una strada sconosciuta non produce un percorso. Array immutabili. Lo stesso ordine è usato in tutti i server, indipendentemente da geometria o ordine dei vicini nel JSON.

Il browser visualizza la catena con **nomi delle strade** in italiano/inglese e, prima di esporre qualsiasi elemento della proiezione, confronta l'intero percorso con la BFS della plancia pubblica. Verifica estremi, adiacenze, ordine canonico, distanza minima, identificativi delle carte/slot pubbliche, revisione e token del posto. Una falsificazione di lunghezza, percorso, distanza, origine, identità o revision produce *vista non disponibile*, senza influire sulle altre autorizzazioni. Fino a cinque attività mostrate, tutte senza pulsante di acquisto. Nessuna modifica al 3D, alle carte, ai comandi o all'audit.

La traiettoria è una **spiegazione geometrico-logica**, non una promessa di quanti turni o mosse serviranno: il movimento gratuito continua a usare solo `turn-options` e il server. Gli archi della plancia inferiti richiedono signoff #4/R-10. Dettagli e checklist [#50](https://github.com/KeyserDSoze/Game.Edonism/issues/50).

**Nota regressioni CI #50:** i tipi `IReadOnlyList<string>` sono read-only ma i record C# confrontano le liste per riferimento; i test che verificano equivalenza di proiezioni fra revisioni confrontano contenuto serializzato/strutturale. I mock Playwright eseguono in Node 24, e per non importare in quel processo il JSON della plancia attraverso Vite mantengono un **fixture test-only** del grafo pubblico. La build React usa sempre il board ufficiale condiviso. I test in GitHub Actions restano obbligatori per verificare entrambe le implementazioni.
