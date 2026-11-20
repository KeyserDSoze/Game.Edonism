# #184 — Sorting fully verified public PvP rival dossier

## Scope / authority

The Development-only rival dossier (#181) already cross-checks every public
rival's current road and printed seven-road graph path against independently
authenticated .NET `/tactical-overview` and `/public-territory` results for
one actor, bearer, match, round and revision. #182 focuses public rival lots;
#183 displays an audited public rival's position/path on the city map.

The sorting control is strictly a **display-only presentation preference**.
It makes no new API request, gameplay command, money/ownership transition,
prediction of turns, attack authorization, faction inference or victory score.

## Deterministic display invariants

- **Original player order** (default) preserves the already verified
  `verifiedPublicRivalProximityDossier` row order.
- **Nearest public street distance** sorts by the independently audited
  `streetSteps` ascending. A step is a printed road-graph edge, not a turn.
- **Most public controlled lots** sorts by `rivalControlledLots` descending.
  Rivals with zero publicly controlled lots remain in the dossier/map.
- Ties retain the index of the original verified row, not locale-sensitive
  text ordering or hidden/derived scores; do not mutate the verified array.
- The native IT/EN labelled select has `aria-controls` bound to the dossier
  row list and works on keyboard and narrow displays. Only show it after
  the **entire** #181 dossier passes both existing verification leases.
  Forged, extra-field, stale, incomplete or malformed HTTP must hide the
  whole dossier and selector. Never display partial information.
- Switching sort leaves #182 lot filters and #183 city map focus in place.
  Match/actor/token/revision changes reset the sort to original order and
  independently clear stale actor focus through the existing lifecycle.
  No browser storage, bearer persistence, card or permission changes.

## Verification

- Real Vite mocked Playwright on 2/4/8 seats compares displayed IDs to
  the audited numeric DOM values in canonical order and sorted order,
  including deterministic tie resolution and eight-seat zero-lot rivals.
  Verify keyboard operation, independent lot filter/map focus, no game POST,
  actor switch reset, forged tactical/territory 200 hide and authorized recovery.
- Live browser Playwright against genuine .NET API at 2/8 seats checks sorted
  row order against original independently audited public facts and restores
  canonical order. Existing .NET xUnit tests remain part of all three CI jobs,
  not replaced by mocked browser calls.
- Track source, tests and docs on GitHub [#184](https://github.com/KeyserDSoze/Game.Edonism/issues/184).
  Commit to `main` only after #183 passes all three CI jobs on its exact
  latest SHA. Close #184 only after its own exact-head 3/3 success. Rules,
  combat and production identity parents #4/#6/#8/#13 remain open.

Target version: `0.0.2`.
