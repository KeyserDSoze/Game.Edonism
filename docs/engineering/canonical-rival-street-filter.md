# Canonical public board-street filter for rival-controlled lots (#94)

## Purpose and authority
This is a **Development-only read-only PvP scouting** convenience, downstream of #85/#88/#89/#90/#92/#93 and tracked as [#94](https://github.com/KeyserDSoze/Game.Edonism/issues/94). It is not movement range, combat, buying, a faction/hostility inference or permission, and does not implement the unresolved printed rules #4 or Production identity #13.

The dropdown is populated only from the board's seven immutable public `cityBoard.streets` IDs and printed street names (the same JSON consumed by .NET). Its selected ID is constrained to that list; it does not inspect drawing geometry or issue any HTTP request. Every held-lot row originates from the fully validated actor/token/round/revision-scoped #88 atomic tactical overview, including the canonical public `route.streetId`, `streetPath` and owner. Invalid or tampered tactical data makes the whole projection unavailable, not a synthetic replacement.

## Predicate intersection and focus safety
The ordered public `opponentControlledLots.routes` are filtered by **independent predicates**:

1. Verified public owner (#89), or all known rivals.
2. Selected canonical street ID (#94), or all streets.
3. Existing nearby display preference (#85), 0–1 street-graph edges only.
4. Existing public henchman posture (#93), all/standing/fallen.

No sorting or street-step recomputation takes place in the browser, preserving the server's `streetSteps,ownerPlayerId,slotId` tie-break. The #90 per-rival nearest lot is the first *visible* canonical route, or an explicit empty state; the #92 public player-position focus persists for every verified other seat even when every lot is hidden by filters. Every filter change invalidates stale map focus, and actor/token/match changes reset all local display preferences without persistence. The existing independent map-focus verifier checks the selected target and path before rendering. No new API endpoint, gameplay command, audit/match revision change or credential storage is introduced.

## Coverage and release gate
- **xUnit .NET 10 (2/4/8 actors):** every canonical board street, independently checked against owned-lot snapshot slots, sorted route order, owner/posture/nearby intersections, canonical paths, public audit and unchanged checkpoint. City hall remains a valid filter choice but has no activity lots.
- **Playwright mocked:** 2/8 actor views, compositional filters, empty nearest-lot state with retained verified player focus, keyboard/mobile and IT/EN, actor/token rotation, forged route rejection and no extra tactical GET. English mobile WebGL-disabled browser also tests the street selector.
- **Playwright live vs real .NET:** two independent seat capabilities check chosen held-lot streets against the server projection and reject an alternate street, while asserting no extra tactical reads, public revision or audit changes.

Run all three standard CI jobs on the **exact final `main` SHA**; only close issue #94 after 3/3 success with closure note.
