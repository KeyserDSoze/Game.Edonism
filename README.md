# Edonism

Edonism è un gioco strategico web PvP/PvE ambientato in una città di proprietà, attività commerciali e personaggi ("Pucciottini"). La foundation 0.0.1 è **solo un'anteprima tecnica**: le regole di gioco, l'economia e le interazioni multiplayer arriveranno dopo la revisione del game design.

## Stack

- **World renderer 3D:** Three.js, React Three Fiber e Drei, con esagoni e pucciottini placeholder generati da primitive 3D.
- **UI:** React, TypeScript, Vite, shadcn/ui e Tailwind CSS (tema system/light/dark, italiano e inglese).
- **Backend:** ASP.NET Core .NET 10, con Domain/Application/Infrastructure/API separati.
- **Tests:** xUnit, Playwright; gate GitHub Actions.
- **Principio:** il server sarà autoritativo per le azioni di gioco PvP/PvE. Il frontend non può assegnare denaro, proprietà o modificare lo stato canonico.

## Sviluppo locale

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

Frontend: `http://localhost:5173`. Backend: usa la URL HTTP stampata da `dotnet run`; verifica `/health` e `/api/v1/meta`. Il frontend non necessita del backend per visualizzare la demo iniziale.

### Test frontend

```bash
cd src/frontend
npm run build
npx playwright install chromium
npm run test:e2e
```

## Layout

```text
src/
  backend/
    domains/Edonism.Domain/
    business/Edonism.Application/
    infrastructure/Edonism.Infrastructure/
    applications/Edonism.Api/
  frontend/
    src/components/ui/       # shadcn/ui, fuori dalla scena 3D
    src/features/city/        # rendering 3D + geometria demo
    src/features/settings/    # theme state
    src/i18n/                 # localizzazione
tests/backend/                # xUnit
docs/architecture/
docs/engineering/
docs/patch-notes/
.github/workflows/
AGENTS.md
```

La struttura riprende i confini di [Vuxo](https://github.com/KeyserDSoze/Vuxo), ma usa un renderer 3D anziché Phaser 2D.

## Governance e roadmap

Ogni feature/bug passa da una issue a un branch e a una PR con test. La foundation è tracciata in [#1](https://github.com/KeyserDSoze/Game.Edonism/issues/1). Il registro sintetico è in `docs/engineering/development-ledger.md`; la guida di lavoro è `AGENTS.md`.

Regole, modelli e grafica definitiva saranno aggiunti quando disponibile il materiale originale di Edonism. Non interpretare la mappa demo come contratto di gioco.
