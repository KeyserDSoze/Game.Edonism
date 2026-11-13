# Fail-closed atomic public tactical scope verification (#100)

## Scope of the invariant
The Development-only PvP tactical overview endpoint returns exactly one read-only, authenticated #88 snapshot containing the `uncontrolled`, `otherPlayers` and `opponentControlledLots` projections. They must all belong to the same current match, seat/actor, round, server revision, and public source street. This guide tracks [issue #100](https://github.com/KeyserDSoze/Game.Edonism/issues/100).

The frontend has three separate, mandatory layers:

1. **Capability/race guard (React):** verify current in-memory bearer token, current actor/seat, match UUID, latest public revision and aborted request state. A delayed response for an old actor/token/round cannot update the current view. The creator's all-seat credentials remain Development-only.
2. **Atomic scope guard (pure helper):** `hasAtomicPublicTacticalScope(response, expected)` in `src/frontend/src/features/matches/publicTacticalScope.ts` checks all five fields against the authoritative current public context, at the outer response and each of its three nested projections. It rejects missing, null, array, primitive, mismatched or forged scopes. This is read-only structural validation, **not a new authorization mechanism**.
3. **Deep semantic guards (pure #101 extraction):** `validateUncontrolledPublicRoutes`, `validateOtherPublicPlayerRoutes`, and `validateOpponentPublicLotRoutes` compare public lot/card counts, owner identity, standing/fallen posture, street-graph paths, distance and canonical server order with the latest authoritative public match snapshot. These remain necessary even when scope fields match.

Any layer failing invalidates the **entire** atomic display (no partial views) and prevents public route or map-focus rendering. Never infer attack, movement, purchase, faction, private card details or Production identity from passing these checks. The game rules #4 and Production login #13 remain unresolved.

## Determinism and tests
- **Pure Playwright runner:** 2/4/8 valid public seat fixtures; expected actor/match/round/revision/street mutation, five fields at four levels (top + three nested), null/array/primitive/absent scope values and mixed valid/forged nested data; deterministic, no browser/network requirement and no modifications to the input.
- **Mocked browser:** 8-seat Development fixture with a valid outer response and forged `opponentControlledLots.playerId`, requiring all three public tactical widgets, all filtered lot/owner controls and map focus to remain unavailable; only one atomic tactical GET and unchanged game revision.
- **Existing live Playwright + real .NET:** two distinct bearer sessions, verified actor-scoped snapshots, no extra requests or state/audit mutation.
- **Existing xUnit .NET 10:** 2/4/8 route/owner/street/posture/public-audit and checkpoint invariants.

This change does not move fetches, UI local state, token storage, actor race checks or any Domain command. Three job gates (.NET/xUnit, React mocked Playwright, real React + .NET Playwright) must all pass on the **exact current main SHA** before closure.

See [#101 route semantics](pure-public-tactical-route-validators.md) for the direct validation matrix and pure module boundary.
