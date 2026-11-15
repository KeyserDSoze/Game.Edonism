# Canonical public player street ingress (issue #123)

## Problem
A typed Development HTTP public match with a matching boardVersion could previously name an arbitrary nonempty player streetId. The browser's 3D markers would fail closed for the invalid street, but the session revision and ETag could still accept the contradictory public location.

## Guard
The existing narrow public snapshot envelope now verifies every player streetId against the IDs in the exact canonical shared Edonism board JSON already imported for board-version validation (#122). This check runs before creator, join, polling and command public-state admission, without copying a street list or computing moves in React.

This is a transport-compatibility invariant only: the .NET Domain remains authoritative for positions, adjacency, commands and first-round audit. A malformed card, controlled lot or gross salary quote remains independently handled by its view-specific guards; the ingress does not suppress legitimate unrelated public information.

## Regression gates
- Six actual-Vite Playwright tests: 2/4/8-seat genesis, all seven canonical streets, each endpoint seat injected with 13 invalid values, audit chronology rejection, immutability and independent bad-card tolerance.
- Three xUnit Theory cases for 2/4/8: canonical player streets through every first-round free move, end turn, settlement pending and Domain checkpoint restore.
- Full existing .NET xUnit, mocked UI Playwright and live React/.NET Playwright CI must all pass on the exact final main SHA.

No Production API, login, card effects, money or PvP rule changes.
Issue: https://github.com/KeyserDSoze/Game.Edonism/issues/123
