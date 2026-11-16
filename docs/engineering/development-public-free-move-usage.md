# Read-only server-confirmed free-move usage in the Development city (#136)

## Why

The Development .NET 10 `MatchSnapshot.Players` already contains the
public `FreeMoveUsed` Boolean for each 2–8-seat first-round player. The
Development browser's public envelope validates this Boolean but
`publishPublicPositions` previously dropped it before forwarding the
public city projection to `App`. A PvP observer inspecting the city
could see verified street, origin, owner and active seat but not
whether a rival had **already** spent their free move.

## Transport vs gameplay authority

- Only forward the existing `freeMoveUsed` public field from the accepted
  server snapshot. Do not attach credentials, private hands or new API
  reads to the 3D/DOM city.
- A dedicated *read-only* city helper uses the canonical printed street
  set and an all-or-nothing 2–8-seat identity/Boolean check. Incomplete,
  malformed, duplicate or foreign-street fixtures display **no**
  free-move indicators rather than a misleading partial subset.
- The label explicitly says *used* or *not used*, **never available**.
  A seat can have a not-used move but no legal action because of a
  turn, phase or server-authorized options constraint. Browser logic
  never grants a move nor calculates a route from this bit.
- The current public street / original lot / 3D pawns / controlled
  activity views remain independent; no new public revision, game POST,
  active-seat or ETag change is caused by inspecting the flag.
- Both IT/EN render readable text without requiring color or WebGL.

## Automated regressions

1. xUnit .NET 10 Theory 2/4/8: snapshot starts with false for all seats;
   after one accepted server `TryFreeMove`, only the mover is true;
   a rejected second free move leaves the flags and revision unchanged.
2. Actual-Vite TypeScript Playwright 2/4/8: valid per-seat Boolean map,
   immutable input, flag changes, and all-or-nothing failure for duplicate
   IDs, missing/wrong flags, foreign roads and invalid record/container.
3. Mocked React Playwright 2/8: city labels before/after an honest move,
   locale switch, no-WebGL/mobile, seat switching, zero extra commands,
   and removal on leave.
4. Real browser + .NET API: initial and post-move city status equals the
   server's own public snapshot, with other player unchanged.

Development 0.0.2 only. Depends on #6, #112, #133 and verified #135.
Issue [#136](https://github.com/KeyserDSoze/Game.Edonism/issues/136);
close only after three exact-final-main CI jobs pass.
