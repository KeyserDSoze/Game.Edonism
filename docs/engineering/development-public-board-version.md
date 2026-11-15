# Development public snapshot canonical board identity (#122)

## Authority and compatibility boundary

The game's canonical printed city board, its streets and activity slots are
versioned in `src/shared/board/edonism-board.v1.json`. Both the .NET 10
`BoardCatalog.LoadDefault()` / `GameMatch.Snapshot().BoardVersion` and
the React city renderer use this **same shared source**.

A browser should not mount an HTTP public match snapshot reporting a
different `boardVersion` while it renders the local version of the city.
Prior to #122, `hasValidDevelopmentPublicEnvelope` validated the
untrusted public match ID, turn actors, revision, audit records and ordered
seats but did not check the published board version. A forged response
could therefore attach otherwise coherent PvP turns to a foreign map.

## Pure fail-closed ingress

The existing `hasValidDevelopmentPublicEnvelope` now imports the **one
canonical JSON asset directly**, and verifies `boardVersion ===
canonicalBoard.version` before accepting a public snapshot. Missing,
empty, nonstring, altered-case or foreign versions all fail. This check
is deliberately limited to **identity of the shared board contract**:
it does not reimplement street adjacency, activity effects, salaries,
game rules or server-authorized command logic.

The shared envelope guard already runs before:

- Creator `/from-full-deck`: any all-seat credentials or initial match
  could be bound;
- Atomic authenticated `/seat`: actor, turn options or private hand
  could be installed;
- Authenticated public polling: revision, ETag, public city or next actor
  could be changed, including same-revision caching;
- Command readback, including a 409 reconciliation read: a returned
  public state could become visible.

The Domain is still the sole source of truth for movement and all
PvP transitions; this is browser transport-compatibility validation,
not a Production identity/security mechanism.

## Tests

`verified-development-board-version.spec.ts` imports the real Vite
TypeScript public envelope and first-round audit chronology guards,
and the actual city board module. Seven Playwright cases cover
2/4/8-seat valid genesis snapshots, exact canonical version, missing,
null, empty, malformed, version-suffixed, case-altered and foreign
board versions, and immutable input.

All existing direct-Vite test fixtures that call this shared ingress
were brought into agreement with the canonical board version; legacy
assertions, test counts and coverage are preserved.

Three full mocked browser tests exercise forged foreign board versions
on creator 201, authenticated atomic joined-seat 200 and public poll
200, respectively. The UI must not bind an actor/hand or cache the
foreign board view. Retrying with a legitimate match response recovers;
the polling regression also checks a subsequent conditional 304 and
real command-driven revision increment.

Three .NET xUnit Theory cases for 2/4/8 seats verify the authoritative
shared JSON board version remains unchanged across each accepted free
move, end turn, first-round settlement-pending state and checkpoint
roundtrip restoration.

No Production endpoints, original card art, permissions, power rules,
economy or actual round advancement are added. Do not weaken the
existing mocked, xUnit or live .NET Playwright suite or CI settings.

[Issue #122](https://github.com/KeyserDSoze/Game.Edonism/issues/122):
close only after all three CI jobs are completed/successful on the
**exact final `main` HEAD**.
