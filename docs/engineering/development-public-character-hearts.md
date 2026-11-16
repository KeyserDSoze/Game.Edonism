# Public character hearts in Development city roster (#137)

## Source-backed behavior

The 0.0.2 Development .NET 10 `GameMatch.CreateFromTrustedCharacterCatalog`
and `CreateFromTrustedFullDeckSetup` assign each of 2–8 seats a
synthetic character, whose `PrintedInitialHearts` is validated by
`CharacterSetupComposer` in range **1–5**, and published in the existing
`MatchSnapshot.Players[*].Hearts` public field. Characters and hands
are not implemented as real combat mechanics. The older
`CreateFromTrustedSetup` fixture intentionally has `Hearts = null` for
every player: it has no assigned character card.

The initial public city projection previously dropped `hearts` in
`DevelopmentMatchLab.publishPublicPositions` before handing the
street/owner/free-move readouts to `App`.

## Narrow visualization contract

The public projection now forwards only the existing `hearts: number |
null` field, **never tokens, hands or factions**. The pure
`verifiedPublicCharacterHearts(unknown)` helper checks 2–8 entries,
technical IDs with the same bounded UTF-16 and Unicode policy as
the already accepted public envelope, pairwise distinct roster IDs and
canonical streets on the versioned shared JSON board. Hearts may all be
null (legacy: no status) or must *all* be safe integers 1–5. Mixed
nullable/numeric sets or bad fields hide the entire hearts projection.
It never derives positions or gameplay permission.

IT/EN readable text says `Cuori personaggio: N` /
`Character hearts: N`. This means **public character-card hearts in
the implemented first round**, not live HP/damage/attacks. No client
combat rules, new server endpoints, action calls, storage or private
information. Original real printed character art/data remain blocked by
#19.

## Test coverage and release gate

- .NET xUnit Theory 2/4/8: the real seeded Character + Activity fixture
  matches per-player published hearts against assigned card metadata,
  holds the same heart count after an actual accepted move and end turn,
  with a valid Domain public audit; existing legacy-null regression stays.
- Real Vite TypeScript Playwright 2/4/8: all values 1–5, null-only
  fixtures, malformed/missing/out-of-bounds/nonnumeric, duplicate and
  invisible/foreign roster, partially-null cases fail closed, fixtures
  unchanged.
- Mocked React Playwright 2/8: initial IT/EN labels, a server-shaped
  free move, seat switching, zero extra commands, remove on leave,
  mobile/no WebGL.
- Full React + actual .NET Playwright: 2-seat full deck, server-reported
  card hearts equal to the public city labels before/after movement.

Issue [#137](https://github.com/KeyserDSoze/Game.Edonism/issues/137).
Commit directly on main; close after all 3 jobs green on exact last HEAD.

## #141 — Cross-check the same public character assignments

The #137 transport validator previously accepted any well-formed 1–5
`players[*].hearts` and canonical street. In a full-deck .NET first-round
match there is a stronger already-public source of provenance:
`MatchSnapshot.AssignedCharacters[*]` contains one unique
`PlayerId`/`CharacterId`/`StartingActivityCardId`/
`PrintedInitialHearts` record per seat. The browser had dropped this
**public** list while forwarding player positions, and therefore could
show a forged public rival heart count even if the corresponding public
character card record disagreed.

`verifiedPublicCharacterHearts` now receives **one public scene state**,
requires exactly one well-formed distinct assignment per displayed seat,
nonempty unique character and initial-activity card IDs, matching
`printedInitialHearts === hearts` (safe integer 1–5) for every
seat, canonical player streets, and valid exact technical IDs. Any missing,
duplicate, foreign, mixed, mismatched or malformed assignment hides
**all** heart labels, without altering legitimate public pawns, economy,
resources, commands, credentials, session revision, or the broad public
envelope. Legacy null-heart / empty-assignment matches remain blank.
No additional API call, no client combat or faction/hand inference.

xUnit .NET 2/4/8 tests the real seeded public card/heart/origin
provenance and stability after move+turn; actual-Vite Playwright 2/4/8
tests malformed/forged assignments and legacy; mocked React 2/8 tests
rendered fail-closed isolation on bad server responses; live .NET 2/8
compares city heart badges to the server's assigned cards. Track
final CI and acceptance at [#141](https://github.com/KeyserDSoze/Game.Edonism/issues/141).
