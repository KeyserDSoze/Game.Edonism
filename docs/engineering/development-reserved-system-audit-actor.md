# Reserved technical audit actor ID (issue #128)

## Problem
The public match audit starts at revision 0 with a fixed actorId `"system"` for the `match-created` event. Until this patch, a technically valid player seat could ALSO be named `"system"`, so later real-player movement and turn-end events would carry the same actor identifier as the audit genesis, despite different authority. It also allowed a forged public HTTP 200 to claim a roster seat named `"system"` and advance the browser revision/ETag.

## Authority and narrow policy
The single .NET `MatchParticipantId.IsValid` validation now excludes **only** the exact lower-case identifier `"system"`. That helper already feeds all four Development fixture creators, the independent character/deck composers and the authoritative public audit replay setup. Invalid creator requests must yield 400/no-store, no new match or credentials. Invalid checkpoints must not restore and invalid replays publish no frames.

The browser's existing `isValidDevelopmentTechnicalPlayerId` mirrors the same reserved value before the shared public envelope binds creator, join, poll or command session, revision and ETag. The audit genesis **continues** to use the reserved `"system"` actor; this is not a generic ban of system events, future public event kinds, or printable `System`/`SYSTEM` player IDs. Preserve exact case without trimming, renaming or permission inference. This does not change any game rule, faction, wallet, card, Production authentication or server-authoritative movement.

## Regression gates
- Existing xUnit technical-ID policy and 6 trusted creation/composer paths extended to reject `"system"` while `"System"` and `"SYSTEM"` remain allowed.
- 4 Development creator integration xUnit cases prove 400/no-store and no credentials/state, plus a legitimate follow-up API creator with a valid bearer.
- 3 xUnit theories for 2/4/8 seats: trusted setup must reject reserved ID, genuine case-distinct public audit verifies through moves/turns/settlement and checkpoint, modified roster/checkpoint containing reserved ID fails replay without partial frames or restore.
- 6 real Vite Playwright TypeScript checks for 2/4/8 seats include reserved ID rejection and case-distinct valid IDs with the genuine `match-created` genesis still present.
- A separate full-stack Playwright test invokes the REAL .NET Development creator (without creating a fixture) with `system` in both first and last seat positions, expects no-store HTTP 400, and checks no credentials or state leaks.
- Full mocked React Playwright injects a coherent forged HTTP 200 with matching reserved seat ID in players/turn orders/active player/audit plus plausible revision/ETag; no public revision, private hand or cached ETag changes; genuine subsequent command succeeds once.
- Three GitHub Actions jobs must pass on the exact final `main` SHA before closure.

Tracking: https://github.com/KeyserDSoze/Game.Edonism/issues/128
