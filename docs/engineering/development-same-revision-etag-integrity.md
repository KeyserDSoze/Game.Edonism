# Development same-revision public snapshot and ETag consistency (#121)

## Motivation and authority

In the implemented first round of Edonism, .NET `GameMatch` changes public
game state **only** when a validated command commits a newer revision with an
audit event. Repeated authenticated snapshots, actor-scoped private reads,
turn-option reads and Development seat-token rotations are **not** gameplay
commands and do not change the public snapshot at the same revision.

Previously the React long-poll accepted an HTTP 200 with a valid typed
public envelope, valid #119 audit chronology and unchanged revision for
ETag caching, even if its public body contradicted the last accepted state.
`acceptServerState` itself correctly refused to republish an unchanged
revision, but `lastPublicTag` could still be filled for a different
snapshot. This is a **public read/cache consistency** defect, not a bypass
of .NET command authorization.

## Pure public-only equivalence check

`hasSameDevelopmentPublicSnapshotAtRevision(current, candidate, matchId)`
compares *complete public JSON data*, including every visible player
street, free-move flag, audit event, activity placement and gross salary
quote. It requires the exact same match ID and safe integer revision.
For object fields, JSON property insertion order is irrelevant; arrays
(including player order, public board and audit chronology) remain ordered.
Numbers, strings, booleans and null must be identical and valid JSON
primitives. Undefined, non-JSON objects, excessive depth and oversized
node counts fail closed. A bounded recursive structural comparator
prevents excessive work from an untrusted HTTP body.

The helper reads only public snapshots. It never reads, compares, logs
or persists bearer credentials, private hands, hidden factions or
private draw piles, and never derives legal moves or gameplay rules.
The .NET Domain remains the sole authority for gameplay and the audit.

## Polling integration

React keeps a **public-only current snapshot ref** synchronized with its
monotonic accepted revision at creator creation, authenticated atomic
join and accepted newer command/poll snapshots. It clears that ref
whenever the local session is reset or revoked. This avoids depending
on an outdated closure while a long-poll is in flight.

An authenticated HTTP 200 is ETag-cacheable only after the existing
public envelope and chronology checks, plus one of two conditions:

1. A **newer** revision is accepted by `acceptServerState`; or
2. The **same** revision's complete public JSON is structurally identical
   to the current accepted public snapshot.

A malformed or divergent same-revision 200 is ignored before
`lastPublicTag` is mutated. The next unconditional 200 may be valid and
establish the revision ETag, after which a 304 is safe and authorized.
Newer real .NET commands continue to advance revision normally.
The existing exact match/token scopes, revocation and long-poll
cancellation logic remain intact.

## Regression coverage

`src/frontend/e2e/verified-development-same-revision-snapshot.spec.ts`
loads the real Vite TypeScript helper in **seven** Playwright tests
covering 2/4/8 valid cloned/public JSON, changed field insertion order,
street/flags, players/turns, audit entries, activity ownership, salary,
extra/missing properties, malformed data, depth/node limits and
immutability.

Two browser regressions in `development-match.spec.ts` simulate a
forged same-revision HTTP 200 with either Bob's street changed or
Alice's gross quote altered. Both 200 responses have a canonical
matching revision ETag and otherwise well-shaped first-round public
history. The next genuine HTTP 200 must be **unconditional** (no cached
ETag from forgery); then an authenticated 304 with the correct ETag
is allowed. A real end-turn advances to revision 1 exactly once;
the secret bearer remains absent from URL and browser storage.

Three .NET 10 xUnit Theory cases for 2/4/8 seats in
`DevelopmentSameRevisionSnapshotContractTests.cs` assert repeated
authorized read, hand, options, atomic bootstrap and token rotation
all preserve the exact serialized public snapshot until the first
accepted server command, which creates revision 1 and audit event 1.

Run and preserve all three project gates: xUnit, mocked Playwright
and real .NET Playwright. No test timeouts, workers, retries or
assertions are weakened. **Scope:** Development first-round
projections only; no Production login, economy or settlement changes.

[Issue #121](https://github.com/KeyserDSoze/Game.Edonism/issues/121):
close only after all three jobs are successful on exact latest `main`.
