# Development first-round public audit chronology ingress (#119)

## Source-backed invariant

The .NET 10 `GameMatch` creates `match-created` at public revision
**0**. Every accepted first-round free move or end turn increments the
revision once and appends exactly one public `MatchAuditEvent` at that
revision. `MatchAuditReplay.Verify` is the *authoritative* interpreter:
it validates acting seat, legal adjacent streets, turn progression,
positions, movement flags, phase and terminal settlement-pending state.
A snapshot with revision `N` has exactly `N+1` events, one for each
revision 0..N, all in round 1.

Previously the React guard (#112/#113/#116) verified each event's
runtime **record shape**, phase/actor parity, and the public player
containers independently. It did *not* check whether events were
consecutive or whether genesis corresponded to `revision=0`. A
successful-looking HTTP 200 could claim revision 99 with only a
well-shaped genesis event, become the current session/revision and pin
the conditional polling ETag. Its public audit would then be false.

## New pure runtime ingress guard

`hasValidDevelopmentPublicAuditChronology(value, expectedMatchId)`
uses the existing public-envelope runtime validator and then checks:

- current first-round `round === 1`, a nonempty public event array,
  and `events.length === revision + 1`;
- exact genesis record: revision 0, round 1, kind `match-created`,
  actor `system`, both street fields `null`;
- every later event is a well-shaped public record with
  `event.revision === index` and `event.round === 1`.

This is a narrow **public transport integrity** check, *not*
a JavaScript audit replay. It intentionally does **not** check future
public kind names, actor turns, street adjacency, balance, played
cards, public salary or settlement. The independent audit renderer
still hides unknown/private event kinds; the server verifier remains
the only gameplay authority. Never export tokens or private cards.

### Entrypoints

Before any match/session/actor capability binding or state/revision
mutation, the creator response validates its public audit chronology.
The single-bearer `/seat` bootstrap rejects a malformed timeline
**before** it binds private hand or options. Polling HTTP 200 (including
same-revision responses with a purported ETag) must satisfy chronology
**before** accepting the public snapshot or storing the ETag.
Command responses pass through the same `acceptServerState` guard,
so no forged high-revision result can hide later genuine revisions.

A malformed snapshot cannot mutate visible public city/hand/turn
state. On a subsequent valid server response the browser recovers at
its original revision; a forged 200 does not authorize or replay
commands.

## Regression testing and existing mock reconciliation

`src/frontend/e2e/verified-development-public-audit-chronology.spec.ts`
imports the real Vite TypeScript guard in seven browser tests:
positive genesis, free-move/end-turn, 2/4/8-seat pending settlement
and well-typed future public event shape; negative gaps, duplicate,
missing, extra and reordered revisions, bad genesis/round, malformed
records/containers and immutable fixtures.

Three additional mocked Playwright browser tests exercise a forged
revision-96 poll with genesis only (then genuine revision-1 turn/ETag
recovery), a creator response with valid tokens but false audit
revision (reject then valid retry), and an atomic joined-seat
`/seat` with mismatched audit revision but valid actor/hand/options
(reject then retry). Existing `conflictOnFirstMove` fixture was
aligned to a **real .NET-shaped** competing `turn-ended` event at
revision 1 rather than an invented revision 3 with no events. An
unknown-kind privacy fixture now uses consecutive event revisions,
so it still verifies that unknown kinds are hidden, without
contradicting the transport contract.

`DevelopmentPublicAuditChronologyContractTests.cs` adds three
xUnit 2/4/8-seat Theory cases asserting the real .NET server emits
genesis and every intermediate revision consecutively, including
the final pending-settlement event. The full mocked UI, xUnit and
real .NET Playwright gate must pass without reducing test coverage,
worker count, timeouts or retry settings.

**Scope limit:** This contract is specific to the *implemented first
round* in Development. Adding later rounds/new event schemas to
#4/#6 requires an explicitly versioned progression contract, not
silently admitting incompatible state.

[Issue #119](https://github.com/KeyserDSoze/Game.Edonism/issues/119):
do not close before all three CI jobs complete successfully on the
final exact `main` SHA.
