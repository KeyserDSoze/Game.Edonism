# #182 — Read-only rival dossier → opponent-lot scouting filter

## Purpose

The Development PvP match laboratory already has an audited public rival dossier (#181, combining #178 tactical graph + #179/#180 public territory), and an independent, read-only opponent-lot owner selector (#99/#95). To make the dossier **actionable as information, not gameplay**, each verified public rival has a keyboard-accessible button that chooses that same rival in the already existing opponent controlled-lot filter. No other menu or game command is introduced.

## Authority and lifecycle

- The focus button exists **only** under the two independently authenticated, actor/round/revision-scoped, fully verified public projections that already render the #181 dossier. Malformed/future-key/stale HTTP from the .NET tactical-overview or territory endpoints never creates a focus affordance. The owner is taken exclusively from the verified `rivalPlayerId`, not an untrusted form input, hidden faction or nickname.
- Selection toggles `selectedOpponentOwnerId` in React browser state, not in a server endpoint. To avoid misleading narrowing, clear the existing optional street, posture and nearby-only filters; clear any previously highlighted public map route by `onTacticalFocus(null)`. The actor match state, bearer, deck, private hand, authoritative position and round never change.
- `aria-pressed` reflects the public owner filter. Selecting the same rival again resets to **all other public owners**. With a player holding zero publicly controlled lots, the empty result is an honest visible public count, not an authorization failure.
- The preexisting filter lifecycle clears a seat-specific selection on match/actor/token changes; the dossier and button themselves are hidden when either verification lease becomes stale/unavailable. No stored preferences or production identity.
- Explicit IT/EN accessible labels note that this is **viewing public lots only**; it confers no attack permission, combat range, target lock, victory point, card/action privilege or faction inference. The street distances remain graph edges, not turns.

## Tests

- New mocked React Playwright tests for complete printed 30-card fixtures at 2, 4 and 8 seats: choose rival, confirm `aria-pressed`, drop incompatible pre-existing view filters, compare visible public lot owner/count to the verified technical owner, toggle back to unfiltered view, change authorized seat and confirm no prior selection survives; verify zero state revision change and no POST move/end/rotate commands.
- Extend existing mock forged `GET /public-territory` (root/street/owner/footprint) and forged `GET /tactical-overview` (root/route) browser regression: no dossier **or focus button** until a different valid current actor's fresh report succeeds.
- In existing 2- and 8-seat live Playwright with the genuine .NET API, select one rival and compare the public owner/controlled-lot list to the exact authenticated `/other-player-routes` report, then toggle off. No new .NET behavior; existing xUnit authority tests remain.
- All original CI jobs (.NET xUnit, React/Playwright, live real React+.NET Playwright) must pass on the **exact latest main commit** before #182 closes. Issue-first and direct-to-main workflow; #181 must independently pass first.

Links: [#182](https://github.com/KeyserDSoze/Game.Edonism/issues/182) depends on [#181](https://github.com/KeyserDSoze/Game.Edonism/issues/181) and parents [#4](https://github.com/KeyserDSoze/Game.Edonism/issues/4), [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6), [#8](https://github.com/KeyserDSoze/Game.Edonism/issues/8), [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13). No unapproved printed rules were added.
