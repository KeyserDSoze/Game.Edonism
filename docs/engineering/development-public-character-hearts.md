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
