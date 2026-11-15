# Development PvP first-round turn-order and rotation parity (#120)

## Server-authoritative public ordering

The currently implemented **first round** of the .NET 10 `GameMatch`
keeps the original player seating order in its immutable `_turnOrder`.
`Snapshot()` serializes public `players` in the same order and publishes
`proposedNextRoundOrder` by calling
`GameMatch.RotateLastToFirst(turnOrder)`.

For seats `[alice, bob, charlie, diana]` the public proposal is exactly
`[diana, alice, bob, charlie]`. This is a **preview**, not permission
to start another round, elect a mayor, pay salary or change seat roles;
those actions remain blocked by unresolved #4/#6 rules.

Before #120, the React `hasValidDevelopmentPublicEnvelope` guard
validated that both public order arrays were permutations of the
same 2–8 IDs. This rejected missing, duplicate or invented players,
but it accepted a *well-typed* forged HTTP 200 that swapped two genuine
players in the proposed turn order or shuffled the `players` array.
Such data could mislead the PvP next-round HUD while retaining a valid
actor, audit, match ID, revision and shape.

## Fail-closed ordered projection

The existing shared `hasValidDevelopmentPublicEnvelope` guard now
requires all of the following *before* it returns a typed public match:

- `players[index].playerId === turnOrder[index]` for every seat;
- `proposedNextRoundOrder[index] ===
  turnOrder[(index + count - 1) % count]` for every seat;
- the existing unique nonblank 2–8 seat IDs, correct set membership,
  valid phase/actor shape, and audit record shapes remain mandatory.

The comparison introduces **no** client-side turn resolution or
movements. The .NET Domain is the only authority for actual game
commands and verifying full public audit semantics.

This shared guard is already applied to creator `/from-full-deck`
before binding all-seat bearer credentials, authenticated `/seat`
before binding the actor or private hand, polling 200 before advancing
revision or storing an ETag, and accepted command readback. It also
runs as part of the #119 audit chronology guard. No private cards,
bearers or hidden factions are exposed or cached.

## Test coverage

`src/frontend/e2e/verified-development-turn-order-parity.spec.ts`
loads the actual Vite TypeScript ingress guard in **seven** deterministic
Playwright tests, spanning 2, 4 and 8 seats, valid genesis and complete
first-round settlement snapshots, wrong but complete proposed
permutations, stale player and turn order, malformed containers and
immutability.

`src/frontend/e2e/development-match.spec.ts` contains **three** further
full mocked browser tests:

1. A forged public polling 200 claims revision 1 and Bob active with a
   correct two-event public audit, but a false next-round order. The
   browser retains its real revision 0, turn, private hand and ETag,
   then accepts Alice's genuine end-turn revision 1 and the correct
   proposed order without duplicate commands.
2. A creator's valid-shaped credential reply with an incorrect
   next-round proposal cannot establish a match or disclose private
   cards. A subsequent valid response succeeds.
3. A Bob `/seat` atomic bootstrap with correct actor/hand/options but
   a false public proposal cannot bind a session or private hand.
   Retrying with a valid response succeeds without leaking Alice.

`DevelopmentPublicTurnOrderParityTests.cs` adds **three** xUnit
2/4/8-seat Theory cases asserting the actual server preserves player
ordering and exact proposed rotation after each accepted free move,
end turn and at pending first-round settlement.

Existing mocked and real `.NET + Playwright` suites stay in place;
no timeout/retry/worker changes or test skips are permitted.

**Future-gameplay limit:** When #4/#6 define a real next-round
transition and any variable seating rules, this *current first-round
projection* contract must be revisited explicitly, never treated as an
approved new gameplay rule.

[Issue #120](https://github.com/KeyserDSoze/Game.Edonism/issues/120)
may close only after all three CI gates pass on the exact final
`main` commit.
