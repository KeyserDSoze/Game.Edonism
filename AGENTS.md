# Edonism — Engineering conventions

## Scope and architecture
- This is a PvP-first browser city strategy game. Do not invent canonical rules before reading user-supplied game design documents.
- Backend .NET 10: `src/backend/domains` (deterministic rules/aggregates), `business` (use cases), `infrastructure` (adapters), `applications` (HTTP/SignalR surface).
- Frontend React + TypeScript + Vite: `src/features/city` is the 3D scene (Three.js + React Three Fiber), `src/components/ui` is shadcn/ui and DOM app chrome. The **original printed street graph** and 30 activity lots are described in `src/shared/board/edonism-board.v1.json` (issue #5); axial hexes are NOT gameplay coordinates. Do not mix visual preview with authoritative gameplay state.
- Future PvP/economy state MUST be validated and applied server-side. Clients submit intentions, not trusted game outcomes.
- Prefer deterministic generation (explicit seed + version) and maintain auditability for any money, ownership and PvP transitions.
- The board graph and slot IDs are data-driven and shared between .NET and React. Never derive movement from preview geometry or pretend the source document defines unapproved PvP rules.

## Mandatory issue workflow
1. Inspect current repository, tests, docs, `docs/engineering/development-ledger.md`, and existing GitHub Issues.
2. Create/claim an issue with goal, scope, acceptance criteria, target version and test plan before coding.
3. Set ledger status to In progress. The game designer currently requests **direct commits on `main`**; keep each commit linked to a GitHub Issue and run CI after every code batch. If this workflow changes in future, use a branch/PR without bypassing issue tracking.
4. Test with xUnit for backend rules and Playwright for visible frontend behavior, including mobile, language and theme.
5. Do not close issues until relevant tests and CI (on `main` for direct commits) are green, docs and patch notes updated, and a closure note recorded. Fix CI failures before starting the next feature.
6. Keep `VERSION` as release source of truth, update `docs/patch-notes/` for release changes.

## Frontend conventions
- React Three Fiber v9 / Three.js: scene input, 3D objects and camera only.
- shadcn/ui + Tailwind semantic tokens: navigation, HUD, cards, selectors, forms and modal surfaces.
- Theme: `system`, `light`, `dark`; persist choice in localStorage.
- i18next Italian and English, no new hard-coded UI strings.
- Accessible equivalents for important canvas interactions: controls outside WebGL are keyboard-operable.
- No externally owned/third-party art in final assets. Code-generated geometric placeholders are acceptable.
- Test fallback and narrow screens, avoid requiring WebGL for critical interactions.

## Backend conventions
- Keep Domain independent from ASP.NET Core, EF and serialization frameworks.
- No DB or migration until the game rules define aggregates and persistence requirements.
- No client-authoritative ownership, currency or PvP.
- Compile with nullable enabled and warnings as errors; xUnit for deterministic tests.

## Commands
```bash
dotnet restore Edonism.slnx
dotnet test Edonism.slnx -c Release
cd src/frontend
npm install
npm run build
npx playwright install chromium
npm run test:e2e
```
