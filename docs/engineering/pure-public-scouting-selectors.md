# Pure public PvP scouting selectors (#99)

## Refactor boundary
[Issue #99](https://github.com/KeyserDSoze/Game.Edonism/issues/99) extracts only **display computation** from `DevelopmentMatchLab.tsx` into `src/frontend/src/features/matches/publicScoutingSelectors.ts`, a deterministic, side-effect-free TypeScript module. No gameplay rules, API contracts, .NET Domain objects, tokens, browser storage, React, graph geometry or new endpoints are added.

The **caller** remains responsible for validating the complete #88 tactical overview under the real Development seat bearer. Only when `tacticalLease.token === token`, match ID, actor ID, round, verified revision and source street all match the currently authenticated session is `tactical` non-null. A forged/invalid/revoked/stale projection is already rejected before selectors are called; the helper is *not* an authorization boundary and **must not** be used to process unverified raw JSON.

## Pure inputs and outputs
`selectPublicScoutingView(verifiedOtherSeats, verifiedOpponentLots, canonicalStreets, localFilters)` accepts only the public verified seat roster, public rival-controlled route list, seven canonical board street IDs/names, and the current browser view preferences. Results:
- **selectedOpponentOwner / selectedOpponentStreet:** bound to known verified other IDs and board street IDs; unknown local choices revert to all.
- **visibleOpponentLots:** four independent owner, street, nearby (0–1 public graph edges), standing/fallen predicates, preserving audited server route order and never deriving an action/attack/buy permission.
- **rivalLotStreetDistribution:** seven canonical rows, computed from the **complete** public set regardless of active filters; each street has total, standing/fallen and only positive other-owner groups in the verified roster order.
- **nearestVisibleLotByRival:** one record per verified other seat in public order, with that same verified public rival-position route and the first matching canonical lot or null. All rival positions remain separately viewable even when no lot is shown.

The React component continues to render localized IT/EN accessible controls, manage match/token transitions, reset local filter preferences and stale map focus, and make the existing authenticated HTTP reads. No network call or authenticated field has moved into the helper.

## Test plan and release gate
- **Dedicated Playwright selectors:** deterministic 2/4/8 public-seat fixture parity, seven canonical streets/zero-lot City Hall, exact owner/posture sums, server route order/nearest preservation, combined owner+street+nearby+posture, empty list and unknown local preferences; verifies input is never mutated.
- **Existing mocked React Playwright:** 2/8 browser seats, accessible mobile/IT-EN/keyboard/WebGL fallback, owner/street/nearby/posture pair selection/reset, forged atomic overview rejected, seat/token rotation and unchanged tactical GET count.
- **Existing live Playwright + real .NET:** distinct Alice/Bob bearer tokens, actor-scoped routes and distributions, public audit/revision unchanged; refactor cannot weaken these gates.
- **Existing xUnit .NET 10:** 2/4/8 server-authoritative public routes, posture/street/owner counts and immutable checkpoint/audit.

Close #99 only with **all three CI jobs green on the exact final commit of `main`**; canceled superseded runs cannot be counted as passes.
