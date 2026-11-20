# #183 — Verified PvP rival dossier → city street-path focus

## Product intent

The Development match lab already exposes a *public, server-authoritative*
2–8 seat rival dossier (#181) that joins the independently verified `/tactical-overview`
and `/public-territory` .NET views, and an existing read-only city-map focus
contract for a public player position. #182 added a distinct, browser-only
opponent lot owner filter. This slice makes the dossier's **verified public
route** directly inspectable on the city map without transferring any
gameplay authority.

The player can select **Show position on the city board** on any certified
opponent row; the existing city highlights that player's printed-road
shortest path from the observing actor's position to the rival's *current
public street*. The UX uses the same `TacticalFocus` contract as the
previously audited `dev-focus-rival-player-<id>` control in the tactical
inspector, never fabricates a new route, and never sends commands.

## Security / scope invariants

- **Only** render a per-rival map button when the entire #181 dossier is
  present for the same current bearer, actor, match, round and revision.
  The dossier rechecks every 2–8 rival's full six-property tactical
  wire row, canonical seven-road shortest graph path and counts against
  the separately authenticated .NET territory standings; partial
  responses or forged/extra HTTP JSON fields fail closed for the WHOLE UI.
- Button focus is `{kind: "player",matchId,revision,actorId,targetId,
  streetPath}` with the target from a verified `rivalPlayerId` and a
  fresh `[...streetPath]` copy. It never selects a lot to purchase,
  attack or corrupt, or grants a movement or card-power permission.
- A player owning **zero public lots** has a public position and must
  remain map-focusable. The observing seat is excluded.
- The #182 lot filter and its `aria-pressed` state are independent:
  focusing a rival's map route does **not** change owner/street/posture
  filters or HTTP state. Changing a filter intentionally invalidates an
  obsolete map route; existing actor/credential/round/revision transitions
  clear the old focus. No browser storage, URL bearer or private hand.
- Street graph edges are **not** move turns, attack range, diplomacy,
  or a victory score. The printed-board adjacency inferential rows
  still await designer approval under #4 and cannot be used to claim
  final combat mechanics.

## Tests

- Real Vite/React Playwright mocked for **2, 4 and 8** seats: compare
  `city-renderer[data-focus-path]` and visible public-player target
  to the exact verified dossier row's graph path; keyboard Enter,
  preserve owner filter, invalidation upon owner change and seat switch;
  public zero-lot rival in 8-seat setup; no new POST/free-move,
  token rotation or revision.
- Extend forged raw `/public-territory` (root, street, owner, footprint)
  and `/tactical-overview` browser tests: map focus button never
  appears under invalid 200, but a new authenticated actor's
  verified dossier restores only the new rival button, not the
  previously revoked actor's.
- Existing **real React + .NET** full-board live 2/8-seat tests compare
  each shown dossier graph path and the highlighted map path to the
  independently fetched bearer-scoped `/other-player-routes` DTO.
- Preserve all existing .NET 10 xUnit authority tests, React Playwright,
  live API Playwright and Node discovery guard jobs. New UI tests are
  not a substitute for xUnit or the live server.

**Issue:** [#183](https://github.com/KeyserDSoze/Game.Edonism/issues/183),
depends on [#181](https://github.com/KeyserDSoze/Game.Edonism/issues/181)
and [#182](https://github.com/KeyserDSoze/Game.Edonism/issues/182).
Parents [#4](https://github.com/KeyserDSoze/Game.Edonism/issues/4),
[#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6),
[#8](https://github.com/KeyserDSoze/Game.Edonism/issues/8) and
[#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13) stay open.
Publish directly on `main` only after #182 3/3 exact-SHA CI success.
Close #183 only after its own final main SHA passes all 3 CI jobs.
