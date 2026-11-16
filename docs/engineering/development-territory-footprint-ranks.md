# #159 — Verified public territory footprints, competitive ties only

## Scope
Development-only `GET /api/dev/matches/{matchId}/public-territory` already returns the actor-authenticated #158 server-verified full public 30-card board. Its new `footprints` array is a comparison of all 2–8 players' **controlled lot counts**, with standing/fallen henchmen and number of distinct printed streets with owned lots. Zero-lot players appear. No additional endpoint, match action, authority to attack, victory score, win claim, trading price, power, vote or movement is created.

## Source, trust and shape
- The same `GameMatch.VerifiedPublicTerritoryForActor` first-round audit and complete 30-card / 7-road owner, category, slot and posture validation from #158 remains the only trust boundary. From those **already validated street rows**, use the same public roster positions to sum each player's controlled/standing/fallen counts and occupied-road count. Check sums against all seven rows and the complete controlled-lot count.
- Sort by controlled lots descending and technical `playerId` ordinal ascending. Equal controlled lots share **competition** position (1,1,3 rather than 1,2,3); neither fallen posture nor road count breaks the tie. **These are not rules for declaring victory** under the printed faction system.
- `PublicTerritoryFootprintOrdering.Rank` is a pure deterministic helper that rejects invalid counts, duplicate/reserved/unreadable technical actor IDs and impossible occupied-road counts. It does **not** audit data supplied by untrusted callers; the Domain passes it only its server-validated owner rows.
- `footprints` is an immutable read-only list; no card IDs, private hands, faction, wallets, bearer tokens or encrypted checkpoint are exposed. The report retains `matchId`, bearer-bound `playerId`, `round`, `verifiedRevision` and the original seven streets; no second snapshot or mutation.
- Development security remains identical: no/forged/revoked token 404, authenticated incomplete fixture 409, no-store, Production 404.

## Test plan and closure
- xUnit Domain full-deck 2/4/8, owners including zeros, read-only collections, audit/private-hand/ownership stability across free move, end-turn and checkpoint restore.
- xUnit pure 1,1,3, zero lots, differing posture, stable ID tie ordering and rejected invalid actor/counts/duplicate seat, while never inventing card effects.
- xUnit WebApplicationFactory 2/4/8 verifies `footprints` matches each real server controlled lot and road, confidentiality and revoked bearer.
- Playwright live React + real .NET API (2/8) compares every server rank and numeric count against existing #153 DOM list and the authentic board snapshot in one browser frame. Keep mocked and Vite tests unchanged.
- Issue #159, parent #6. Close only after **3/3 jobs SUCCESS on the exact main HEAD SHA**. Printed rules, card powers, mayor, politics, production auth and individual art remain tracked in #4/#7/#8/#13/#19.
