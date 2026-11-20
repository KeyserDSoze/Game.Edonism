# #181 — PvP public rival dossier: independently verified territory + street proximity

## Scope and provenance

The Development-only first-round UI already has two independent, bearer-authorized, auditable .NET 10 sources: #178's atomic `GET /tactical-overview` with routes to every other public player, and #179's `GET /public-territory` with seven printed streets and every owner's controlled lots. #180 confirms a player's relative public lot holdings. #181 joins the **two independently verified projections** into one opponent-by-opponent read-only dossier for real PvP scouting.

**No new server endpoint or authority.** Client does not invent card powers, combat ranges, rival hostility, victory scores, movement permission, taxation, factions, or hidden information. All distances are **graph edges**, not numbers of turns.

## Trust and lifecycle

The React dossier is displayed only if BOTH independent actors' scope checks are simultaneously true:

1. #179 report was previously checked against the same full, canonical 30-card, seven-road public state; only its clean public footprint copies enter `territoryStandings`, guarded by current bearer, match, actor and verified revision. Authenticated partial board 409 means unavailable.
2. #178 raw `/tactical-overview` was validated with exact seven-layer own-key JSON schema, actor/round/revision/fromStreet and full graph/owner/path semantics, retained only under the current bearer lease.
3. `verifiedPublicRivalProximityDossier(snapshot, standings, actorId, others)` independently recomputes #180's exact 2–8 seat lot comparison, verifies full all-others roster and each of six route own properties, `shortestStreetPath`, steps, canonical order, public controlled/standing counts, the current actor's origin street, and the same public snapshot. Extra/future/null keys, missing entries, a forged count/path or a missing owner invalidate **the entire** dossier.
4. The selector returns fresh copies of public-only rows, in ascending audited street distance with ordinal seat ID as tie-break. Each row retains rival ID, public current street/graph path/steps, standing and controlled counts, my signed lot advantage, rank and the canonical IDs of roads we both control.

Match/actor/token/revision changes clear either input lease; a stale or forged response cannot create a confident opponent dossier. No raw HTTP response, bearer, private hand, faction, token, hidden action or storage is used by the new selector.

## Visible UI and tests

The Development lab's compact, accessible IT/EN `dev-rival-dossier` panel lists all rivals including zero-lot seats. It is separate from the head-to-head lot panel and the original public tactical route explorer. Labels clearly deny PvP attack/victory implication.

- New real Vite Playwright `verified-public-rival-proximity-dossier.spec.ts` 2/4/8 seats: canonical roads/paths, public lot ownership, zero-lot and tie behavior, no input mutation; rejects wrong step/path/street/actor/count/standing, unexpected own keys, missing or duplicate/reordered route, missing actor/footprint/partial board.
- Extend mocked React tests: forged `/public-territory` root/street/owner/footprint already suppress #179, #180 and now #181; after a clean authorized seat switch the dossier returns. Separate forged tactical root/route HTTP 200 with a valid independently verified territory panel must *still* suppress the dossier until actor switch. Complete mock boards must use all seven real canonical slot streets rather than the partial N/S-only heuristic.
- Extend 2/8-seat real Playwright + .NET route/territory contract test: compare each dossier row to the actual independently fetched `/other-player-routes` and `/public-territory` JSON, authenticated under the same bearer/revision. Existing xUnit contracts for both real .NET public projections remain mandatory, unchanged.

**GitHub issue #181** is the source of truth. It depends on #178/#179/#180 and parents #4/#6/#8/#13. First complete #180's **exact-main SHA** 3/3 CI; publish #181 directly on `main` only afterward; close #181 only after its own exact-new-main 3/3 xUnit / React Playwright / live .NET Playwright success. Do not misrepresent first-round scaffolding as complete production multiplayer.
