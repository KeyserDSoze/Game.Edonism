# #172 — Exact authenticated first-round turn-progress wire contract

## Authority and threat model

`MatchFirstRoundTurnProgress` is a .NET Domain **public, audit-verified, read-only** projection for the currently implemented Development first round. The authenticated `GET /api/dev/matches/{matchId}/turn-progress` emits precisely **nine** JSON properties: `matchId`, `round`, `verifiedRevision`, `phase`, `activePlayerId`, `totalTurns`, `completedTurns`, `completedPlayerIds`, `remainingPlayerIds`.

This projection has no authority to skip an offline seat, end a turn, assign a new actor, perform actions, grant cards or pay salary. The .NET match engine remains the sole source of truth for commands. Before #172 the React `DevelopmentMatchLab` already reconciled counts, identities, phase, turn order and revision against the server public snapshot. It nevertheless allowed **additional arbitrary JSON properties** on the raw authenticated HTTP 200 and retained that original response as `turnProgressLease`. A forged HTTP response could carry `skipTurn`, `token`, `privateHand`, `disconnectTimeout` or `futureTurnPermissions` in UI memory. These are NOT actual fields emitted by .NET, and this is defense in depth rather than an observed server information leak.

## Implementation boundaries

- The pure `hasValidDevelopmentFirstRoundTurnProgress(result, publicState)` imports the original public envelope verifier and rejects any response whose set of **own** keys is not exactly the nine existing .NET DTO fields. Input is neither changed nor silently sanitized.
- The snapshot remains independently verified with `hasValidDevelopmentPublicEnvelope`. Its 2–8 canonical match seats, round, revision, phase, actor, and authoritative `turnOrder` are required to align with the complete progress response. A phase-0 actor can only be the seat at the declared completed-index. All earlier seats are in `completedPlayerIds`; the current and later seats are in `remainingPlayerIds`; phase 1 has null active actor and all seats complete. Any missing/duplicate/foreign/out-of-order player or malformed array invalidates the whole lease.
- All existing actor-scope match/seat/token/revision checks and abort handling in React stay in force **before** publishing the hint. A forged or unavailable progress response hides the progress list but leaves valid game commands, private hand, credentials and public audit untouched.
- There is no new turn control, no invented PvP timer, no client adjacency logic, no Production authentication, and no modification to the .NET DTO or Domain rules.

## Tests

- `src/frontend/e2e/verified-development-first-round-turn-progress.spec.ts`: actual Vite source in Chromium for 2, 4 and 8 seats, including technical Unicode actors, first/middle/last/pending snapshots, exact source DTO properties despite JSON key order variation, extra root properties (even false/null), missing required keys, bad phase/revision/round/count/actor/roster/arrays, immutability.
- `src/frontend/e2e/development-match.spec.ts`: a forged authenticated `/turn-progress` response carrying extraneous future-skip and private-hand metadata hides the progress panel while leaving an actor's valid commands untouched; subsequent correctly bound re-read after switching seat recovers the progress display, without generating a command or exposing secret strings.
- `tests/backend/Edonism.Domain.Tests/DevelopmentFirstRoundTurnProgressExactWireContractTests.cs`: real `WebApplicationFactory` .NET Development API for 2, 4 and 8 players, exact 9-key JSON on every actor before and after each completed turn including phase 1, canonical order and no private metadata, `Cache-Control: no-store`, anonymous denial and Production 404.

Issue [#172](https://github.com/KeyserDSoze/Game.Edonism/issues/172), parents [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6) and [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13). Close only after **all three** CI GitHub Actions jobs (.NET/xUnit, real Vite Playwright, Live React + .NET Playwright) complete with `success` against **the exact final `main` commit SHA**. 
