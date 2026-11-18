# #176 — Exact pending-settlement preview wire contract (Development only)

## Authority and threat boundary

The already-existing .NET `GET /api/dev/matches/{matchId}/settlement-preview` is a bearer-scoped **read-only** projection from the Domain's first-round audit. It exists only while the match is awaiting settlement after all seats have ended their turns. The proposed next turn order is NOT applied, no salary is paid and the 0/1/2 tax scenarios are **hypothetical alternatives**, not an elected mayor's chosen policy or a wallet transfer. Genuine .NET JSON consists of four exact record shapes:

| DTO | Exact JSON own fields |
|---|---|
| `MatchPendingSettlementPreview` (6) | `matchId`, `round`, `verifiedRevision`, `nextTurnOrder`, `grossSalaryQuotes`, `hypotheticalTaxScenarios` |
| `MatchGrossSalaryQuote` (4) | `playerId`, `baseAtoms`, `standingActivityAtoms`, `grossAtoms` |
| `MatchHypotheticalTaxScenario` (3) | `hypotheticalTaxAtomsPerPlayer`, `potentialWithheldAtoms`, `players` |
| `MatchHypotheticalNetSalary` (4) | `playerId`, `grossAtoms`, `hypotheticalTaxAtoms`, `hypotheticalNetAtoms` |

React already matched actor, round, revision, proposed order, public salary quotes and every 0/1/2 scenario's arithmetic. It did NOT reject **extra JSON properties** at root, quote, scenario or per-player row before saving the raw HTTP 200 to `settlementLease`. A forged transport reply could carry `privateHand`, `selectedMayorTax`, `walletCredit`, `otherPlayerTokens`, future commands or even `metadata:null` while preserving correct totals. The real .NET API **does not** emit these keys; this is defense in depth rather than an observed server leak or newly discovered permission bypass.

## #176 behavior

The pure Vite `hasVerifiedDevelopmentPendingSettlementPreview(raw, verifiedPublicSnapshot)` retains all existing arithmetic and authoritativeness conditions, and in addition requires the **exact own enumerable keys at all four DTO levels**. Any missing/extra (including null/false), null/array, foreign/duplicated/out-of-order actor, wrong phase/round/revision, bad salary/tax amount invalidates the WHOLE preview. Insertion order of valid JSON keys never matters; do not silently strip dangerous fields.

The public snapshot is independently validated before this guard is called. It must contain 2–8 technically valid unique seats, the verified revision and proposed order; the 0/1/2 hypothetical scenarios must match the original gross quotes. An invalid preview shows unavailable; the actor's verified match, private hand, session, server-granted turn commands, actual atoms and audit are untouched. No new gameplay, mayor election, tax payment or production login is implemented.

## Test plan and CI gate

- Actual Vite source `src/frontend/e2e/verified-development-pending-settlement-wire.spec.ts`: 2/4/8 Unicode technical actor fixtures, exact 6/4/3/4 keys and 0/1/2 tax examples, arbitrary field insertion order, extra/missing/null/malformed root/quote/scenario/row, immutable inputs.
- React browser `src/frontend/e2e/development-match.spec.ts`: forged HTTP 200 with extra root, quote, scenario or row keys at pending settlement hides whole read-only panel, preserves private hand/revision, no command; actor switch to genuine GET restores the same public figures without leaking sentinel fields to DOM, URL or storage.
- xUnit real ASP.NET Core WebApplicationFactory `DevelopmentPendingSettlementExactWireAfterRotationTests` for 2/4/8 actors: all seats observe identical exact shape and arithmetic after real end-turn commands, `no-store`, bearer protection and revocation after rotation, unchanged wallets/events/revision, Production 404. These cases complement existing endpoint and Domain calculator tests.

Track [#176](https://github.com/KeyserDSoze/Game.Edonism/issues/176), parents [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6) and [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13). Close only after all three CI jobs (`.NET 10 / xUnit`, `React / Playwright`, `Live React + .NET / Playwright`) report `completed/success` on **the exact latest main SHA**. Unresolved game-design decisions remain in #4.
