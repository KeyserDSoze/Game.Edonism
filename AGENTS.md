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
- The Development-only match laboratory is under `src/features/matches` (#20), hidden by `import.meta.env.DEV`. Do not expose its creator-issued all-seat tokens or synthetic catalog through Production, URLs or localStorage; real PvP authentication belongs to #13.
- The public-only match-to-city marker projection (#22) lives under `src/features/city/playerMarkers.ts`; it receives only player IDs, street IDs and the current actor. Its X/Z values are view placement on existing road rectangles, never Domain movement coordinates. Keep an accessible roster for WebGL fallback.
- Activity and henchman visuals (#23) use `src/features/city/activityMarkers.ts` and only public `boardActivities`, `controlledActivities`, and `grossSalaryQuotes`. Never infer ownership from position or award gross salary in React; cardinality/owner/posture validation must fail closed, and keep a WebGL-free roster.
- The first-round public audit verifier (#24) lives in `Edonism.Domain.Matches.MatchAuditReplay`: only the existing four event kinds are supported. Update the verifier and its tamper tests before adding new Domain audit kinds. The browser's `publicAudit.ts` whitelist is display-only and must never become authority. Do not claim that a verified movement log is persisted game restoration, salary/election settlement, or Production authorization.
- Test fallback and narrow screens, avoid requiring WebGL for critical interactions.
- For interactions that cross React → ASP.NET Core (match commands, private projections, reconnect), use **both** fast mocked Playwright UI tests and the real API suite `npm run test:e2e:live` (requires backend Development on loopback). GitHub Actions runs all three gates (xUnit, UI, full-stack). Never claim mock-only browser tests prove API behavior.

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
# Separate test suite requiring the local .NET Development API on 127.0.0.1:5080:
npm run test:e2e:live
```

- The two-browser Development lab (#25) uses an in-memory single-seat join (match UUID + bearer token) and server-authenticated polling. No token in URLs, logs, localStorage/sessionStorage or React's public 3D projection. Never treat the creator's all-seat credentials or clipboard access as Production identity. Gate all Dev routes and this lab from Production; test real browser isolation, monotonic revisions and 409 reconciliation.

- Encrypted Development checkpoints (#26) are opt-in, single-process and NEVER Production persistence. The Domain checkpoint contains secret action hands/draw pile: never return it from APIs, logs, telemetry, browser JSON or fixtures committed to Git. Store only SHA-256 of 256-bit random bearer tokens inside AES-256-GCM ciphertext. Changing event kinds/phase/quotas requires a version bump and restore validation/tests; do not imply public audit replay #24 alone can restore secret state. Keep keys out of Git; do not enable this mode by default in CI.

- The Development match lab's 2–8-seat fixture (#27) must keep synthetic character starting activities within each printed activity category quota **for any sampled subset**; the server is still authoritative for character draw, street placement and turns. Test multi-seat privacy and mobile/i18n in mock Playwright plus 8-seat first-round progression and single-token join against real .NET live E2E. No Production account or real card metadata is implied.

- Dev seat-token rotation (#28) is capability-based, NOT Production identity. Only the current 256-bit token in the request header may rotate its seat; never accept a client playerId. Persist the new digest first under the match lock before invalidating the previous digest. Rotation MUST NOT mutate the game revision, history, hand or public scene. Never expose credentials via URL, logs or storage; return only one seat token with no-store. Test failure rollback, post-restart revocation, concurrent rotation, mock UI and real multi-browser Playwright.

- Turn options (#29) are **read-only actor-scoped projections** computed by the .NET Domain from its canonical street graph and current revision. The React Development lab may translate server-returned street IDs into labels, but may neither infer permission from local geometry nor enable commands when a revision, player, token or match differs. After polling, seat switch, token rotation or 409, refresh options; a missing response must fail closed. This is NOT an action-card effect, round-settlement mechanic or Production action API.

- Conditional Development snapshot polling (#30): always authenticate the per-seat token before returning a revision ETag or 304; no 304 to anonymous/revoked/malformed credentials, no private state in the tag, and no Production routes. The browser may send `If-None-Match` only for its current match, current in-memory token and confirmed revision; 304 must not parse JSON or update game state. A changed revision forces a full 200; refresh on foreground/online and stop network polling while hidden. Gate with xUnit + mocked and real-API Playwright.
