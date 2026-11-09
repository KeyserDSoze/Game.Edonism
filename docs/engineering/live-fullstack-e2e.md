# Real end-to-end test: React/Vite ↔ ASP.NET Core .NET 10 (#21)

## Perché esiste

La slice [#20](match-ui-dev-bridge.md) ha collegato la UI di prova al match engine, ma i test Playwright del browser usavano **mock HTTP**. La #21 introduce una verifica integrata con il **backend Development reale**, su loopback, e test separati da quelli mocked. La sorgente per le regole rimane `rulebook2.zip`; questi test **non aggiungono** regole di round, carte, elezioni o PvP.

## Come eseguire localmente

1. Installare .NET 10 SDK, Node 24 e Chromium Playwright.
2. Avviare dalla root, in un terminale:

```bash
ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://127.0.0.1:5080 \
  dotnet run --no-launch-profile --project src/backend/applications/Edonism.Api
```

3. In un secondo terminale:

```bash
cd src/frontend
npm install
npx playwright install chromium
npm run test:e2e:live
```

Playwright avvia Vite su `127.0.0.1:5173`. Il proxy `/api/dev` inoltra le richieste **solo localmente** a `127.0.0.1:5080`. Il test live **fallisce** se il backend non risponde: non ripiega su fixture/mock. Non confondere `npm run test:e2e` (10 test mock/UI) con `npm run test:e2e:live` (3 test integrati, richiedono .NET).

## CI in tre job indipendenti

`.github/workflows/ci.yml` conserva i job preesistenti:
- `.NET 10 / xUnit`: compila e lancia tutte le prove di dominio/API.
- `React / Playwright`: compila TypeScript/Vite e lancia UI mock tests, temi/i18n e mobile.

Il nuovo job `Live React + .NET / Playwright` esegue restore/build .NET Release, installa Node/Chromium, avvia il servizio ASP.NET Core `ASPNETCORE_ENVIRONMENT=Development` su indirizzo loopback `127.0.0.1:5080`, attende un GET `/health` positivo e lancia `playwright.live.config.ts`. In caso di errore raccoglie log API e trace/screenshot Playwright come artifact. Il job aggiuntivo preserva il gate precedente a due job (vedi incidente [#15](https://github.com/KeyserDSoze/Game.Edonism/issues/15)); il workflow è verde solo quando **tutti e tre** sono passati.

### Cosa verificano i 3 test senza mock

1. Creazione del full-deck fixture realmente serializzato dal browser (cataloghi sintetici 46/23/58 + election-day), 30 attività collocate, due personaggi/giocatori; primo movimento su un arco presente nel grafo, rifiuto di seconda mossa gratuita, fine turno di alice, movimento e fine turno di bob, revisione corretta, stato finale `AwaitingRoundSettlement` senza nuovo round.
2. L'API rifiuta mani senza token e con token inventato; accetta ciascuna mano soltanto con il suo token e ignora `?playerId=alice` quando l'attore è bob; mani disgiunte, snapshot pubblico privo degli ID segreti, nessuna credenziale conservata in `localStorage`, `sessionStorage` o nell'URL.
3. Un attore fuori turno riceve `409 not_your_turn`; una strada inesistente riceve `409 unknown_street`; un comando su revisione obsoleta riceve `409 revision_conflict` e **solo il comando accettato** incrementa la revisione.

I risultati del test sono verificati dalle risposte ASP.NET Core, **non** da un JSON inventato in Playwright. Non c'è ancora un vero test multi-browser/multi-sessione autenticato di Production: resta #13.

## Confini di sicurezza e note sulle fixture

- È un harness **Development-only**. Il creator riceve token per tutti i posti: utile per debugging, non sicuro per il PvP pubblico.
- Le card IDs demo non rappresentano le carte originali; i loro file/materiali sono ancora in acquisizione (#19). Mai introdurre i cataloghi sintetici come fonte del regolamento.
- Non si apre una nuova route in Production e non cambia il contratto `MatchSnapshot`.
- Se si aggiunge una vera feature di partita, implementare prima test xUnit Domain/API e poi sia browser mocked sia un **caso live** quando tocca il percorso reale.

## Risultati

[Prima CI del codice #42692382020](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42692382020): **131 xUnit**, **10 Playwright mocked/UI**, **3 Playwright live**, compilazioni .NET/React senza errori o warning .NET, tre job verdi. Link alla CI finale documentale nel commento di chiusura della [#21](https://github.com/KeyserDSoze/Game.Edonism/issues/21).

## Ultima CI del blocco documentale

[GitHub Actions #42693030133](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42693030133), commit `47bee18`: **131/131 xUnit + 10/10 Playwright UI + 3/3 Playwright live**, tre job **success**, build .NET 10 con 0 errori/warning. Questa esecuzione include le istruzioni di sviluppo e i riferimenti al flusso di prova integrato; la feature #21 è verificata e pronta alla chiusura.

## Copertura multi-browser (issue #25)

È disponibile anche un test Playwright **live** con due `BrowserContext` distinti, senza mock HTTP: Alice crea la partita, Bob entra con **un solo** token, i browser leggono mani disgiunte e osservano tramite polling revisioni, spostamenti e cambi di turno da ASP.NET Core reale. Il test non misura affidabilità di un WebSocket né autenticazione Production. Per riprodurre manualmente il flusso, vedi [due browser Development](two-browser-development.md).
