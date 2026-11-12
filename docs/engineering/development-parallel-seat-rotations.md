# Parallel actor capability rotations (#80)

The Development match API uses 32-byte random bearer capabilities. Under `DevelopmentMatchStore.Entry.Gate`, rotation resolves the old bearer, persists the new digest (if encrypted checkpoint is enabled), publishes it, wipes the replaced digest and wakes subscribers. A second request with the same old bearer must **not** publish a second successor.

## Verified scenario

For every 2–8 seat fixture, two HTTP clients per seat issue `POST /api/dev/matches/{matchId}/rotate-token` simultaneously using the same old bearer. All actors race at the same time. Exactly **one 200 and one generic 404** per seat are valid. New tokens are distinct from each other and from every old token, old tokens cannot read snapshots or private bootstraps or rotate again, and the new capabilities can access only their actor-bound private seat projection.

Rotations must leave the public snapshot byte-identical (revision 0, initial event, no wallet/movement/phase mutation), the public audit valid at revision 0, and allow further independent rotations. Neither a 404 nor a successful capability change creates a gameplay event or changes the ETag.

Tests run through actual ASP.NET Core Development endpoints with xUnit `WebApplicationFactory`, not a mocked store; complete CI includes Playwright UI and Playwright live. Production login, shared multi-instance durability and permission model remain tracked in [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13).

Tracking: [#80](https://github.com/KeyserDSoze/Game.Edonism/issues/80).
