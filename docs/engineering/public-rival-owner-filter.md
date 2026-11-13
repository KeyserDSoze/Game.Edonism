# Public rival-owner lot filter (#89)

A PvP reconnaissance **display-only** choice in the Development city UI. The client never determines whether a player is hostile, has a particular secret faction, may attack or purchase anything, or can travel a number of turns.

## Input and trusted scope

The browser already gets the bearer-authenticated `tactical-overview` from the authoritative .NET Development API under one match lock (#87), and re-verifies the entire envelope/three nested projections against the live public match and canonical path graph (#88). Only after that validation can `otherPlayers.others` populate the owner dropdown; every possible owner belongs to the other seats and the requesting actor is excluded. The routes in `opponentControlledLots.routes` were independently checked against public owner/posture/slot/path/revision.

The choice starts at **All other players**. An individual chosen `otherPlayerId` narrows `ownerPlayerId`, and the optional #85 near-only toggle independently filters routes to 0–1 street edges; both predicates are combined with logical AND. The server-provided ordered list is filtered without sorting, rewriting or contacting the server. Empty public owner groups and zero intersections have an explicit read-only empty state, plus an accessible visible count. IT/EN labels and native keyboard-select behavior apply on mobile.

When the actor, match, or in-memory token changes, including token rotation/revocation, both local preferences reset. Manual owner or near-filter changes clear any stale public city tactical focus. Unknown/forged response owners, incorrect revision, path, count or posture are never shown: #88 invalidates all tactical panels before #89 can run. No private cards/credentials are stored in filters.

## Scope of verification

- 2/4/8-seat Domain tests ensure actor-excluding public owners, immutable canonical route/slot grouping, and unchanged audited checkpoint; only tests, no engine rule changes.
- Playwright mocked checks two- and eight-seat owner/empty/near combinations, English/Italian mobile labels, keyboard focus, absent self-owner, token rotation/revocation, forged tactical envelope and no extra commands or tactical reads.
- Playwright live checks the actual .NET endpoint, same owner/path displayed, owner and nearby composition, read-only focus clearing and unchanged public snapshot/audit after credential rotation.

This is a child of ongoing [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6), after [#84](https://github.com/KeyserDSoze/Game.Edonism/issues/84), [#85](https://github.com/KeyserDSoze/Game.Edonism/issues/85) and [#88](https://github.com/KeyserDSoze/Game.Edonism/issues/88). The inferred street connections require #4 approval; Production identity #13 is not implemented. Track [#89](https://github.com/KeyserDSoze/Game.Edonism/issues/89) and close only on final main HEAD CI 3/3 green.
