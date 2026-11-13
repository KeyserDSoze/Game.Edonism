# Paired verified rival-player and nearest-owned-lot focus (#92)

## Data and authority

A **Development-only, read-only** tactical convenience following #90. Each row comes from the one fully authenticated, revision-atomic public `tactical-overview` (#87/#88). The current actor and unverified public owners are excluded. The rival position button uses exactly `otherPlayers.others[].streetPath`; the other button uses the first matching already-verified `opponentControlledLots.routes` entry **after** #89 owner and #85 nearby filters. When a filter hides all owned lots, the rival's public position is still a valid read-only observation and the lot remains explicitly empty.

The existing independent `verifiedTacticalFocus` validator checks the player or opponent-lot target and the **canonical shortest street path** against the live public scene before highlighting. Every filter, actor, token, match, revision change or revocation clears old focus. Neither button issues an extra GET or changes the Domain, revision, audit, hands, ownership, actions or state. No attack range, purchase authority, hostility/faction inference, wallet, turn count or Production identity is implied; no bearer enters Web Storage or a 3D projection.

## Accessibility and regression gates

IT/EN visible labels distinguish **View player** and **View lot**; each has an actor-specific accessible name. DOM positions include public street and canonical edge count, supporting keyboard, mobile and non-WebGL devices.

- xUnit [2,4,8]: every other player's canonical public path and nearest controlled-lot path from one verified overview, stable nearest order, unchanged checkpoint and valid audit.
- Mocked Playwright [2,8]: filter/empty-lot behavior and independent player focus, keyboard, narrow mobile and IT/EN, forged atomic-scope rejection, seat/token rotation and no extra tactical reads. The existing English mobile WebGL-disabled fallback test now also exercises this paired player button and asserts that forged other-seat paths cannot render it.
- Live Playwright: two real .NET seat credentials, paired player/lot paths independently matched to bearer-scoped server projection, no additional tactical reads, unchanged public revision/audit.

This does not resolve game rules #4, PvP engine #6 or Production identity #13. Close [#92](https://github.com/KeyserDSoze/Game.Edonism/issues/92) only after three green CI jobs on the exact final `main` SHA.
