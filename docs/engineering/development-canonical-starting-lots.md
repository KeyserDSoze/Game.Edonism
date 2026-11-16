# Canonical immutable Development player starting lots (#129)

## Problem
The .NET authoritative match setup and independent `MatchAuditReplay.Verify` require each first-round player `StartingSlotId` to belong to the immutable printed 30-slot board and to be unique. Public Development snapshots always carry those server-authored origin IDs, but the browser shared public envelope previously skipped this property. A coherent forged or malformed public 200 could therefore claim an impossible initial board assignment and seed session/revision/conditional ETag before any separate view-only filter noticed.

## Transport invariant, not gameplay replay
The shared `verifiedDevelopmentPublicEnvelope.ts` now obtains the 30 canonical lot IDs from the SAME versioned board JSON used by the .NET Domain and React city. Every public `players[].startingSlotId` is required, a string, case-exact in that canonical set, and **unique within the validated 2–8-seat roster**. Foreign/duplicate/missing/incorrectly typed lots invalidate the entire creator/join/poll/command public response, so a forged revision/ETag cannot bind.

This does NOT change board topology, validate legal paths or infer a player's current `streetId` from the starting lot after a movement. Server-side GameMatch and MatchAuditReplay alone verify correct starting positions and move/turn commands. An initial lot is fixed while the public current street can move; future well-formed event kinds and malformed standalone activity/card/quote projections remain independently guarded. No Production identity, card powers or settlement functionality is implied.

## Verification
- Six new real-Vite Playwright tests: each of the 30 shared board lots is accepted as a last-seat origin within 2/4/8 distinct origins, alongside the real public chronology; invalid/missing/wrong-case/foreign/duplicate lots reject the entire match; input immutability, valid post-free-move origin preservation and malformed unrelated card tolerance are covered.
- Two full React mocked Playwright regressions: forged next-revision HTTP 200 with a duplicate or foreign starting lot has valid existing actor/turn/audit fields; the browser preserves revision/ETag, public marker, private hand and command capabilities. The genuine end-turn succeeds once afterward.
- Three xUnit Domain theories for 2/4/8 players: canonical unique origins are immutable through legal free moves, turn endings, pending first-round settlement and checkpoint restore; malformed and duplicate origins are rejected by trusted setup and independently verified replay with zero partial frames.
- All 3 GitHub Actions jobs must complete green on the EXACT final main SHA before closing #129.

Tracking: https://github.com/KeyserDSoze/Game.Edonism/issues/129
