# Development public phase/active-seat parity (#116)

## Source-backed contract

The .NET 10 `GameMatch` owns the live PvP-first Development game phase and
actor. In `PlayerTurns` (serialized phase **0**), `ActivePlayerId` is a
player from the authoritative `TurnOrder`; in `AwaitingRoundSettlement`
(serialized phase **1**), `ActivePlayerId` is **null**. The last first-round
end-turn transitions to phase 1, with no automatic salary, taxes, election or
round two (#4/#6). The public JSON is **not** proof of server permission.

Before #116, `hasValidDevelopmentPublicEnvelope` (#112/#113) accepted a
correctly typed, member-of-player-set `activePlayerId` and an allowed
phase **independently**. Therefore both `phase=0,activePlayerId=null`
and `phase=1,activePlayerId="alice"` passed. A forged higher-revision
authenticated HTTP response could enter `acceptServerState` and install
a contradictory display of whose turn it is (or settlement), increment the
browser revision and pin the conditional polling ETag. A later genuine
command response could then appear older.

## Narrow fail-closed browser fix

The existing pure `hasValidDevelopmentPublicEnvelope(value, matchId)`
now requires exactly the .NET public phase/active combination:

- Phase 0: a nonblank string actor corresponding to one of the 2–8 declared
  public players (in both verified turn orders).
- Phase 1: **exactly null**, not a previous/other/blank/undefined actor.
- All existing exact-match ID, safe revision, round, player ID uniqueness,
  turn-order parity, public array containers and per-event runtime record
  checks remain unchanged (#112/#113).

The guard already runs **before** changes to `currentRevision`, session,
public city projection or conditional ETag, and is shared by Development
creator and joined-seat bootstrap. The independent fail-closed public
card/control/quote display guards remain independent. No client-side
rule engine, legal action inference, event-sequence verifier, persistence,
Production authorization or new game phase is introduced.

## Tests and limits

`src/frontend/e2e/public-phase-active-parity.spec.ts` imports the actual
Vite-loaded TypeScript guard in **six Playwright tests**: 2/4/8-player
positive current-turn, last-turn and settlement cases and a negative
matrix for null/blank/whitespace/numeric/unknown active IDs in phase 0,
plus named/undefined/blank/numeric actors in pending phase 1. Fixtures
are checked for immutability.

A seventh Playwright test in `development-match.spec.ts` injects a forged
match response with revision **97**, `phase=1` and Alice still active while
the mock server remains phase 0/revision 0. The browser must preserve the
real actor, private hand, legal end-turn, revision and ETag. It then accepts
a real authenticated end-turn to revision **1**, now showing Bob's turn.
The browser test uses DOM fallback instead of relying on WebGL.

Backend .NET xUnit, real-API 2-browser Playwright, mocked frontend suites,
mobile/i18n and all existing security boundaries remain mandatory.
Close [issue #116](https://github.com/KeyserDSoze/Game.Edonism/issues/116)
only after all **three exact-final-main GitHub CI jobs completed/success**.
