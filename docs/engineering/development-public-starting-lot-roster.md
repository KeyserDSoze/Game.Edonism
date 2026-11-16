# Public PvP player starting-lot roster (#130)

## Why
Edonism's authoritative first-round `.NET MatchSnapshot` publishes each player's immutable `startingSlotId` (the initial activity lot), separately from current `streetId` (which moves). Before #130, the city's accessible public roster showed a colored pawn/road/turn but not this useful starting assignment, making live rival context harder to scan.

## Narrow read-only presentation
The Development match lab sends each verified server player `startingSlotId` alongside its existing `playerId` and current street to the public scene. `App` displays a localized **"Lotto iniziale: N-01" / "Starting lot: N-01"** under each public player in the accessible DOM roster and keeps `data-starting-slot-id` for tests. The current road and active turn display do not change. This works without WebGL, on narrow screens, and for 2–8 seats.

A small pure `verifiedPublicStartingLots` guard uses the same versioned shared printed board for 30 legal lot IDs. If input is malformed, missing, duplicated or off-board, it suppresses **all** starting-lot badges rather than showing an arbitrary first match. The actual public match ingress separately rejects such snapshots before session/revision/ETag in #129. A public starting lot is NOT proof of current ownership, current position, allowed route, auction, secret power, account identity or command permission. Neither browser nor rendering can grant movements or change game state. The original server-private hand/capability and Development/Production boundaries remain intact.

## Verification
- Six actual-Vite Playwright tests for 2/4/8: all 30 board slots, 2/4/8 unique origins, unchanged origin on moved street, failed display for duplicate/missing/foreign/untyped players, immutability.
- Three React mocked browser tests: 2/8 players, Alice's N-01 and Bob's S-01, player selection, movement with unchanged origin badge, subsequent turn-end, leave clear, no cards/bearer in public legend, IT/EN text, 390 px mobile and WebGL fallback.
- One **real React + .NET** browser test in the existing first-round live fixture: exact canonical distinct server-assigned slots match the displayed origin badge; Alice movement changes street but not original slot, no test-only asserted card/token in public roster.
- Three xUnit Domain Theory cases: 2/4/8 canonical distinct initial controlled activities/slots remain unchanged after each free movement, turn ending, first-round pending settlement, and private checkpoint restore.
- The issue remains open until all 3 GitHub Actions jobs are green on exact final `main` SHA.

Tracking: https://github.com/KeyserDSoze/Game.Edonism/issues/130
