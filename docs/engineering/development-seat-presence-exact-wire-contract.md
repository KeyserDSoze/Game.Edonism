# #171 — Development presence exact wire admission (read-only, actor bearer)

## Existing authoritative contract

The .NET Development store defines `DevMatchPresence(Guid MatchId, IReadOnlyList<DevSeatPresence> Seats)` and `DevSeatPresence(string PlayerId, bool IsActive)`. Authenticated `GET/POST /api/dev/matches/{id}/presence` returns exactly the two root JSON keys `matchId`, `seats`; each element contains exactly `playerId`, `isActive`. The server emits the complete canonical seat roster in matching public-player/turn-order order, including inactive seats. The `IsActive` boolean reflects only whether an authorized actor heartbeat was recorded in the last **15 seconds**; it is neither a reliable network connection state nor permission to end, skip, remove, impersonate or act for the opponent.

Before #171, React's `DevelopmentMatchLab` accepted an otherwise consistent forged HTTP 200 presence object with arbitrary extra root or per-seat keys, and stored the original object in `presenceLease`. The inline predicate also assumed every seat entry was a non-null object, potentially throwing on malformed `seats:[null]`; the enclosing catch cleared the lease, but a pure explicit guard is preferable. This is a **frontend trust-boundary defense in depth**, not evidence of a server-side secret leak.

## New pure guard

`hasValidDevelopmentSeatPresence(value, expectedMatchId, expectedPlayerIds)` runs on the real imported Vite source. It requires:

- Exactly `matchId|seats` as root own keys; exactly `isActive|playerId` for **every** seat, no arbitrary extra fields, even with null/false values. Any malformed entry or extra key rejects the entire object; no normalization/stripping of untrusted raw data.
- Exact match ID and full **2–8** unique technically valid public seats in canonical .NET roster order; no unknown, duplicate, missing, shuffled, forged `system` actor, or reordered owner ID. Player strings remain ordinal exact, without trimming or alteration. Unicode accepted according to the existing .NET technical ID policy.
- `isActive` must be an actual boolean for every seat, including valid all-false and all-true rosters. No inference from the current turn, heartbeat timing, ownership, auth or client online state.
- Never mutate public snapshot, command state or input object. A bad presence projection becomes **unknown** in the existing UI, while other verified game views and the actual actor's valid commands remain available. Existing actor-scope checks (token, match, cancel, rotate, revoked bearer) still run prior to setting presence lease.

The .NET API and its authorized heartbeat semantics are **unchanged**. This is Development-only; real Production PvP authentication, presence, disconnect policy and durable storage are tracked under #13 and require explicit design decisions.

## Tests and acceptance

- Actual Vite module `src/frontend/e2e/verified-development-seat-presence.spec.ts`: 2/4/8 real browser-imported valid states (including non-ASCII player IDs), fully active/inactive variants, missing/foreign match, exhaustive root and first/last seat extra keys, null/array rows, wrong booleans, missing keys, duplicate/unknown/shuffled/incomplete/extended rosters and input immutability.
- Browser mock in `src/frontend/e2e/development-match.spec.ts`: an over-wide authenticated POST /presence with extra root token or last-seat timestamp suppresses the whole presence display without revoking session or changing permissions, turn or cards; a clean actor-scoped next read recovers accurate activity. No leaked sentinel metadata to DOM.
- xUnit `DevelopmentSeatPresenceExactWireContractTests` uses real ASP.NET Core WebApplicationFactory Development HTTP for 2/4/8 players. Verifies exact GET/POST wire root+row JSON fields, matching owner order and activity booleans, no-store, no anonymous bearer, no token/secret/private timestamp/turn keys, unchanged match revision/events and Production 404.
- Finish only after all three GitHub Actions jobs (.NET/xUnit, React/Playwright, Live React+.NET/Playwright) are `completed/success` on the **exact latest main SHA**. Keep #171 open until then and record CI evidence in the ledger and issue. Parent #6/#13 remain open.

Related [#171](https://github.com/KeyserDSoze/Game.Edonism/issues/171), [#170](https://github.com/KeyserDSoze/Game.Edonism/issues/170), [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13).
