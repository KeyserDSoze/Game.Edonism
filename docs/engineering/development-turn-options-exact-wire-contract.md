# #170 — Authenticated Development turn-options exact wire contract

## Source-of-truth and why this is a trust boundary

The .NET Domain defines `MatchTurnOptions(Guid MatchId, string PlayerId, long Revision, bool CanEndTurn, IReadOnlyList<string> FreeMoveStreetIds)` in `src/backend/domains/Edonism.Domain/Matches/GameMatch.cs`. The API emits this record from both authenticated Development `GET /api/dev/matches/{matchId}/turn-options` and the actor's atomic `GET /api/dev/matches/{matchId}/seat` as `turnOptions`. **The five fields are exactly:** `matchId`, `playerId`, `revision`, `canEndTurn`, `freeMoveStreetIds`. These are **read-only server-computed hints**, not the permission to execute a PvP command: the .NET server separately checks the bearer, turn and expected revision.

Before #170, `hasValidDevelopmentTurnOptions` checked the known fields, public envelope/actor, canonical street IDs and turn consistency, but permitted extra properties in the raw HTTP object. React retains accepted objects in its in-memory `optionLease`; a forged 200 with `futureActions` or `mayMoveAnywhere` would therefore be carried into UI state despite these not being .NET fields. No deployed API leak or actual command authorization bypass is claimed: this is **client defense-in-depth against a forged transport payload and future accidental trust of extra fields**.

The guard now requires exactly `canEndTurn|freeMoveStreetIds|matchId|playerId|revision` as the sorted set of own enumerable JSON keys, rejects the entire invalid options object, and leaves the original public envelope/chronology checks unchanged. It never strips unknown fields and never infers neighbors, move legality, game powers or an attack range. A valid JSON object with those five keys in any insertion order is accepted when all existing consistency checks pass. In particular:

- 2–8 valid technical seats; same authoritative match/revision and actor from the public state.
- Only the current active actor may end the turn. No destinations for inactive, already-moved or awaiting-settlement players.
- The client verifies only membership in the printed canonical street list, no duplicates, no same-as-current and no fabricated unknown roads. `freeMoveStreetIds` order remains that provided by .NET.
- This applies both to a single `/turn-options` 200 before the option lease is set and to nested `/seat.turnOptions` before any session, private hand or actor bearer is bound.
- The private hand is a distinct authenticated projection, not part of the options DTO. Production auth and durable storage are still tracked in parent #13.

## Tests and gate

- Actual Vite module in `src/frontend/e2e/verified-development-turn-options.spec.ts`: 2/4/8-seat valid active, inactive, moved, last and pending cases; property order compatibility; fail-closed on unknown `privateHand`, `adminActions`, `token`, `futureActions`, metadata and `mayMoveAnywhere` even if their value is null/false; missing required fields; malformed values and snapshot; input immutability.
- Browser mock API integration in `src/frontend/e2e/development-match.spec.ts`: forged GET /turn-options does not enable moving or ending the turn; genuine actor switch/re-read restores controls without sending commands; forged nested /seat options do not install a session, private hand or actor scope, and legitimate retry works.
- xUnit `DevelopmentTurnOptionsExactWireContractTests` uses **real** ASP.NET Core Development WebApplicationFactory for 2, 4 and 8 players: authenticated `GET /turn-options` and `GET /seat` have the exact five-key options JSON, coherent revision/actor/turn, no token/private hand/card/deck/future-action fields in options, no-store, proper separate private hand in the atomic response and Production 404.
- Close #170 only once all three .NET/xUnit, React/Playwright and Live React+.NET/Playwright jobs have finished **completed/success on the exact latest `main` SHA**. Keep parent #6/#13 open.

Related: [#117](https://github.com/KeyserDSoze/Game.Edonism/issues/117), [#124](https://github.com/KeyserDSoze/Game.Edonism/issues/124), [#170](https://github.com/KeyserDSoze/Game.Edonism/issues/170). No gameplay rule or API DTO changes.
