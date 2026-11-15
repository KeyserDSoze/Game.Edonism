# Development public audit actor membership (#126)

## Threat and scope
A malformed-but-typed HTTP 200 event can name actorId "outsider" while presenting correct boardVersion, existing player positions, canonical roads, a continuous public revision and plausible ETag. The independent audit viewer hides an actor it cannot identify, but the session could previously accept that fabricated revision first.

## Narrow transport invariant
After the shared public envelope has validated 2–8 unique player IDs and the immutable seat order, it now requires each public audit event actorId to equal one of those SAME case-exact IDs or the existing technical "system" actor. No trimming or case folding. Reject the **entire** creator/join/poll/command public snapshot and its revision/conditional ETag, not merely a partial audit feed.

This is NOT client-side authorization, event replay, turn legality, a production login feature or new game rules. A future well-typed public event kind with an identified player/system actor remains transport-compatible; all game semantics remain authoritative in .NET. Invalid cards, controlled lots and salary quotes stay independently handled by their view guards.

## Tests
- Six real Vite-imported Playwright tests for 2/4/8 seats, every valid actor, system actor, well-typed future kind, 14 malformed/foreign/case-changed actor IDs, immutable input and unrelated malformed card tolerance.
- One full mocked React Playwright test injects a forgery carrying an unknown actor, higher audit revision and ETag. The browser preserves current actor, revision, private hand, valid controls and accepted timeline; a legitimate end-turn then succeeds once.
- Three xUnit Theory cases for 2/4/8 server-authoritative first-round audit actors across movement, turn endings, pending settlement and private checkpoint restoration.
- The issue closes only when all three GitHub Actions jobs pass on the EXACT final main SHA.

Tracking: https://github.com/KeyserDSoze/Game.Edonism/issues/126
