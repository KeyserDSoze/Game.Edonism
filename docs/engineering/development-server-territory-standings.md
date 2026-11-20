# #179 — Server-confirmed public territory standings in the PvP Development lab

## Scope and rationale

The existing city already projects an independently validated public thirty-card board into seven road rows and actor footprint comparisons (#152/#153). The .NET 10 Domain already provides the authenticated, actor-specific, first-round audit-verified `GET /api/dev/matches/{id}/public-territory` (#158/#159). The Development lab now connects that API to an explicit **server-confirmed** standings panel. The server remains authoritative over the public lot assignments and henchman posture; the browser is only an auditor/viewer, never a game rules engine.

This is intentionally **not** a score for victory. The printed rulebook's faction/role-dependent ownership thresholds and victory claims (#4/#8) have not been implemented.

## Trust boundary and JSON checks

A valid Development bearer (not query `playerId`) supplies the actor. `GET /public-territory` is used only when the browser already has a valid full 30-card public snapshot. The existing authenticated 404 handling applies only to the current actor/token; the API's authenticated 409 on incomplete/legacy board means **unavailable**, never zero controlled lots. Every HTTP request is no-store and aborted on match, actor, token or revision change; late responses cannot populate the new panel.

`verifiedDevelopmentPublicTerritory(candidate, snapshot, actorId)` is a pure TypeScript reconciliation guard:

- Recomputes the full canonical seven-road public matrix and all 2–8 public footprint positions from the independently validated snapshot, not from the route response itself. Fails closed for a partial or malformed board.
- Requires **exact own JSON keys** at all four depths: ten `MatchPublicTerritoryReport` fields; ten fields on **every** `MatchPublicTerritoryStreet`; four `MatchPublicTerritoryOwner` fields on **each** of 7 × N rows including zero owners; six `MatchPublicTerritoryFootprint` fields on every ranked row. Unknown, null, missing or extra properties fail the entire report without sanitizing a raw HTTP payload.
- Checks canonical street order/IDs/names, exact slot/free/held/standing/fallen counts, per-seat owner order and counts, shared-street count, actor/match/round/revision and competition tie positions. All data must match the already validated public snapshot.
- Returns ONLY fresh copies of the locally recomputed **public** footprints. The untrusted raw HTTP body is never stored in a React lease. No bearer, cards, faction, election marker, token or hidden hand is serialized to the UI.

The new IT/EN accessible `dev-territory-server-panel` shows each player's public place, controlled lots, standing/fallen posture and occupied street count. A stale, rejected or absent report shows an unavailable message. It cannot grant movement, purchase, card usage, mayor tax, votes, attacks or any victory.

## Tests and deployment gate

- Real Vite Playwright 2/4/8 guards: 30 canonical slots, eight printed-category quotas, 7-street/whole-roster comparisons; valid and 12 extra/missing-key mutations across root, street, owner and footprint, plus forged actor, revision, totals, row, place, null and absent data. Input immutability.
- Mocked React browser: forged otherwise-consistent HTTP 200 at root, street, owner or footprint; no server-confirmed standings from it, actor switch recovers with a different authorized capability, no game command issued. Other incomplete fixture mocks return 409 instead of treating the authenticated browser as revoked.
- Real .NET + React browser: genuine 2-seat server report matches both the already-verified city footprint and new server-confirmed DOM, using the existing two-browser source checks. Existing xUnit #158 tests already cover 2/4/8 authoritative owner/road matrices, 404, no-store, token rotation, Production 404 and immutability.

Traced under [#179](https://github.com/KeyserDSoze/Game.Edonism/issues/179), parents [#4](https://github.com/KeyserDSoze/Game.Edonism/issues/4), [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6), [#8](https://github.com/KeyserDSoze/Game.Edonism/issues/8), and Production security [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13). Push only after #178 CI 3/3 success; close #179 only when its **exact final main SHA** passes all three original xUnit / Playwright browser / real-API browser jobs.

Nothing in this feature substitutes unofficial assets for the printed catalogue, alters private deck visibility, or removes existing test coverage.
