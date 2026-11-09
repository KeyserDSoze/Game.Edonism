# Edonism

Edonism è un gioco strategico web PvP/PvE ambientato in una città di attività commerciali e personaggi ("Pucciottini"). La release tecnica 0.0.2 mostra **la plancia originale ricostruita in 3D**, ma non è ancora una partita giocabile.

## Stack

- **3D board:** Three.js, React Three Fiber e Drei; strade ortogonali e edifici/pucciottini placeholder originali fatti di primitive geometriche.
- **UI:** React, TypeScript, Vite, shadcn/ui, Tailwind CSS (tema system/light/dark, italiano e inglese).
- **Backend:** ASP.NET Core .NET 10, Domain/Application/Infrastructure/API.
- **Tests:** xUnit, Playwright; gate GitHub Actions.
- **Principio:** il server sarà autoritativo per le azioni di gioco PvP/PvE. Nessuna validazione di movimento tramite coordinate 3D client.

## Avvio locale

Prerequisiti: .NET SDK 10, Node.js 22 o 24 e npm.

```bash
dotnet restore Edonism.slnx
dotnet test Edonism.slnx -c Release
dotnet run --project src/backend/applications/Edonism.Api
```

In un secondo terminale:

```bash
cd src/frontend
npm install
npm run dev
```

Frontend `http://localhost:5173`. Il renderer usa direttamente lo stesso JSON versionato del backend e **funziona anche con API spenta**. L'API espone `/health`, `/api/v1/meta` e `GET /api/v1/board`.

Test frontend:

```bash
cd src/frontend
npm run build
npx playwright install chromium
npm run test:e2e
```

## Layout

```text
src/
  shared/board/edonism-board.v1.json   # 7 strade, 30 slot, vie, grafo e City Hall
  backend/
    domains/Edonism.Domain/World/      # grafo e assegnazione seeded (non match engine)
    business/Edonism.Application/
    infrastructure/Edonism.Infrastructure/
    applications/Edonism.Api/
  frontend/
    src/components/ui/                 # shadcn/ui, fuori dalla scena 3D
    src/features/city/                 # geometria 3D e overlay di esplorazione
    src/features/settings/             # temi
    src/i18n/                          # IT/EN
tests/backend/                          # xUnit
docs/game-design/                       # regole stampate, tracciabilità e punti aperti
docs/architecture/
docs/engineering/
docs/patch-notes/
.github/workflows/
AGENTS.md
```

## Regolamento e priorità delle fonti

Le regole finali di riferimento si trovano nelle 22 immagini di `rulebook2.zip` fornite dal game designer; `document.pdf` è una versione precedente e non può sostituirle. I materiali originali non vengono pubblicati in repository senza una decisione su storage e permessi.

**Decisione mappa #5:** mantenere i movimenti sul **grafo di strade originale**, non su esagoni. Le posizioni dei 30 spazi grigi sono riprese dalla plancia; il Municipio resta al centro. La topologia e le adiacenze sono documentate in [board-topology-v1](docs/game-design/board-topology-v1.md); alcuni archi derivano dalla lettura dell'immagine e richiedono verifica prima dell'attivazione di match reali.

La mappa non assegna attività reali: la scelta delle carte, i turni, l'economia, il PvP e la gestione delle sessioni devono ancora essere sviluppati nelle issue successive. Lo shuffle seeded serve solo per 30 carte **già selezionate**.

## Governance e roadmap

Ogni feature/bug passa da GitHub Issue, branch e PR con test. `AGENTS.md` è la guida di lavoro, `docs/engineering/development-ledger.md` tiene lo stato sintetico. Issue #5 tratta il board; #6 il match engine; #7 carte/poteri; #8 politica/PvP; #9 asset.

## Prototipo motore turni, ambiente Development

La prima verticale del game engine è documentata in [match-engine-slice-1](docs/engineering/match-engine-slice-1.md). L'API di prova si attiva **soltanto** con `ASPNETCORE_ENVIRONMENT=Development` e non è destinata a Internet: permette di creare un fixture con due giocatori e di effettuare un movimento gratuito per turno usando token differenti. Dopo l'ultimo turno il round resta in attesa di risoluzione, perché salario/carte/elezioni non sono ancora implementati.

Le route `/api/dev/matches` non sono disponibili in Production. Il frontend attuale mostra la plancia statica; in futuro useremo l'autenticazione reale e la persistenza per collegare il gioco al server (#13).

## Salario lordo e controllo iniziale delle attività

La prima attività di ogni **fixture** di match Development è controllata dal relativo giocatore, con uno scagnozzo in piedi (15 ancora disponibili). Gli snapshot di `GET /api/dev/matches/{id}` includono `controlledActivities` e `grossSalaryQuotes`: il salario **lordo** è di **2 atoms base + 1 atom per attività controllata con scagnozzo in piedi**. Non è un accredito: saldo, stipendio netto, sindaco, tasse e carte restano da implementare e validare. Vedi [tranche #14](docs/engineering/match-engine-slice-2.md), la parent [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6) e la conferma regole [#4](https://github.com/KeyserDSoze/Game.Edonism/issues/4).
