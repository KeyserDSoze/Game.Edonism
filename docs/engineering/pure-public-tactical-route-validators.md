# Pure public tactical route semantic validation (#101)

The Development-only PvP tactical overview remains a single bearer-authorized, server-audited, revision-atomic **read** (#87/#88). React first verifies current actor, in-memory capability, request-abort state and latest revision. The #100 helper then checks the top scope and all three nested match/seat/round/revision/origin scopes. **Only then** `validatePublicTacticalRoutes` runs three pure deep checks. If any check fails, **all three** public tactical panels are hidden and current map focus is cleared; no partial result is accepted.

## Public data boundary and invariants

`src/frontend/src/features/matches/publicTacticalRouteValidators.ts` takes the expected verified public scope, current public players/cards/controlled lots, and two injected canonical printed-board graph operations (`shortestStreetPath` and `slotById(...).streetId`). It has no React, HTTP, capability token, storage, private cards, browser geometry or mutating game state.

- **Uncontrolled public activities (#49):** exact unowned public slot/card/category set with no duplicates; 0–6 canonical street edges and exact path; ascending steps then slot.
- **Other player positions (#51):** exactly all other public seat IDs and verified current streets; public-held lot counts and standing henchman counts; exact canonical path and ascending steps then player ID.
- **Opponent-controlled public lots (#84):** exactly all verified rival-owned slots, never the viewer's slot; match public owner and henchman posture, printed slot street, path and steps; ascending steps then owner then slot.

All three exports take unknown server projections and return boolean; nulls, missing fields, arrays, duplicates, forged counts, ordering, wrong street paths or cross-actor payloads return false without throwing. The browser never creates movement/attack/purchase authority from these advisory routes.

## Regression and closure

`src/frontend/e2e/public-tactical-route-validators.spec.ts` tests positive 2/4/8 fixtures, unchanged inputs, mutated card/category/count/slot, player identity, owner/posture, graph paths/steps and ordering plus invalid/missing/mismatched scopes. Existing mocked Playwright checks forged nested projections fail closed in UI and map focus; existing real .NET Playwright uses two independent bearer browsers. .NET xUnit remains the authority for path/owner/audit/checkpoint invariants. Issue #101 may close only after **all three CI jobs succeed on the exact final main SHA**; update ledger and issue with actual test totals. No printed rulebook #4 or Production identity #13 is inferred.

## Functional validation result
[CI #43508994557](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43508994557) ran on implementation SHA `e08b1073`: **665/665 xUnit, 177/177 mocked Playwright (13 new deterministic validators), 40/40 live .NET Playwright**, all three jobs completed/success. For issue closure verify again on the final documentation-only main HEAD and record its SHA in #101.

## #104 — Exact public opponent-lot slot selection

The validated tactical focus's **targetId** is the canonical board slot for both an uncontrolled activity and a rival-controlled lot. Once `verifiedTacticalFocus` accepts its match/actor/revision/owner/path, the map's initial `chooseTacticalFocus` must select that **exact** slot, matching the existing final-waypoint behavior. Selecting merely the first slot of the destination street silently highlights a different public lot (for example a verified Bob-owned `S-02` would incorrectly select `S-01`). Player focus still selects a default street slot; manual street/slot inspection clears tactical focus. Neither route display nor selected slot authorizes commands, combat, move or purchases. The mocked #104 regression uses an isolated two-seat fixture with Bob-owned `S-02` and verifies exact selected-slot/aria-pressed, canonical path, waypoint traversal, manual clear and actor rotation. Existing forged/unknown owner tests and live two-bearer .NET tests remain mandatory, with final-main 3/3 CI before closure.
