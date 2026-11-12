# Public PvP routes to other players' controlled lots (#84)

Development now provides **actor-scoped, read-only, audit-verified** street routes to lots controlled by other players. The authoritative .NET Domain computes canonical shortest paths under the match lock from public ownership and standing/fallen henchman posture. The result has slot, owner, posture, street, edge count and inclusive path; no hidden hand, faction, bearer or money.

The Development-only endpoint is `GET /api/dev/matches/{matchId}/opponent-controlled-routes`. It resolves the requester from the bearer only, returns generic 404 for revoked or unknown seats, and inherits `no-store`. Results are sorted by (edge count, owner ID, slot ID) using ordinal IDs; the querying actor's lots are excluded. Reading does not advance revisions or events.

React will validate every lot and canonical path against the current public snapshot and match/revision/seat/token before permitting map focus. This projection never grants movement, purchase or attack permission. Inferred printed street connections still require designer review (#4); all unimplemented full-game mechanics remain blocked by #6/#7/#8.

Tracking [#84](https://github.com/KeyserDSoze/Game.Edonism/issues/84).
