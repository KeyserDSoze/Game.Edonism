# #180 — Server-confirmed head-to-head public PvP territory

## Why

After #179, the Development match laboratory shows a complete 2–8-seat, read-only, authenticated Domain.NET `/public-territory` scoreboard whose raw HTTP JSON must agree with all 30 activity cards on seven canonical roads. It is useful for PvP to compare **my public controlled lot count vs each rival** and see where both control printed activities on the *same* street. Generic standings alone do not expose such a simple pairwise view.

These facts do **not** imply hostility, combat range, target permission, a power, access to a card, ownership change, a win claim, or any faction information. Shared means **both hold at least one activity on the printed road**, not that they may attack.

## Contract and boundaries

`verifiedPublicRivalTerritory(snapshot, standings, actorId)` is a **pure** TypeScript function. Only the #179 verifier's **recomputed PUBLIC copies** of the fully reconciled .NET report reach it from React; the HTTP response itself is never stored or reused. It independently checks the 30-slot/7-road matrix and the exact whole 2–8-seat footprint ranking (all six properties on every row, unique IDs, zero-lot players, competition-tie places), then emits:

- `rivalPlayerId`, `rivalPlace`, `myControlledLots`, `rivalControlledLots`, `myLotAdvantage = myControlledLots - rivalControlledLots`;
- `sharedStreetIds` in **canonical printed-board order**, including empty arrays for nonoverlapping ownership;
- ALL other players in the verified standings' deterministic order, excluding myself.

For *any* missing/extra/mismatched/malformed row, wrong actor, incorrect first-round snapshot, incomplete board, stale revision/seat or unverified API reply, the entire rival list is unavailable, never partially displayed or inferred from a filtered tactical list. The #179 actor token/match/revision/abort lease is an independent mandatory gate. No new HTTP endpoint, bearer, local storage, command or .NET state transition exists.

The compact IT/EN `dev-territory-rivals` panel appears only after successful #179 reconciliation, and disappears across token/seat/revision changes. It has accessible labels, read-only signed differences and road names. This comparison is a **scouting display, not a victory score**.

## Regression coverage

- New real Vite Playwright `verified-public-rival-territory.spec.ts`: complete 30-card board at 2/4/8 seats; equal controlled counts/ties, shared Gauss Avenue, zero-lot opponents, actor-specific exclusion, whole-list deterministic order; every forged count/place/actor/additional metadata/reordering/missing row/partial board and null is rejected, without mutating input.
- Extend the existing #179 browser-mocked forged raw `GET /public-territory` tests: no rivals visible for invalid server reply at root/street/owner/footprint; switch to valid actor-specific bearer regenerates head-to-head data; no game commands.
- Extend existing real React + .NET full-stack per-street/footprint validation for 2 and 8 authenticated players: compare every rendered head-to-head row and shared-road list directly with the actual .NET audited owner rows.
- Keep existing xUnit .NET 10, Playwright React and real API Playwright jobs and all previous tests. .NET model rules are unchanged; xUnit #158/#179 cover all server report invariants.

Issue-first [#180](https://github.com/KeyserDSoze/Game.Edonism/issues/180), depends on [#179](https://github.com/KeyserDSoze/Game.Edonism/issues/179), parents [#4](https://github.com/KeyserDSoze/Game.Edonism/issues/4), [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6), [#8](https://github.com/KeyserDSoze/Game.Edonism/issues/8), [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13). Push to `main` only after #179's exact main CI 3/3 passes. Close #180 only after its own **exact final `main` SHA** passes all 3 original CI jobs.
