# #161 — Complete first-round PUBLIC genesis validation in the Domain audit

## The bug / trust boundary

Before #161, `MatchAuditReplay.Verify(board, snapshot)` could declare an otherwise correctly replayed movement/end-turn log valid even if the snapshot's **public economic and placement facts were tampered**. A client consuming an authenticated Development `/audit` or `/history` could therefore mistake a changed gross salary, fake activity placements, wrong henchman posture/owner or fabricated wallet for a complete verified public first round. Checkpoint restoration already had independent checks; the public audit must also fail closed.

The Domain now runs `MatchFirstRoundPublicSnapshot.Validate` **only after** it verifies the canonical street replay, event revisions/kinds, active seat, phase, positions and free move flags, preserving existing event error codes. Valid snapshots return the same audit and frames. Invalid snapshots return `IsValid=false`, an opaque `invalid_public_*` code, **empty public frames and players** and no data from an unverified prefix.

## Frozen facts of the implemented first round

- All 2–8 canonical players start with **4 atoms**, **2 diplomacy tokens**, **16 henchmen total**, **15 available**. Only free-move and end-turn commands exist, so these resources do not change. This is not a claim about future printed powers.
- Each actor holds exactly one **standing** controlled starting lot from the canonical 30 slots; no initial slot can be owned by another actor and there are no purchases, attacks or fallen controls implemented yet.
- The public activity board is **0 cards for Development legacy slot-only fixture** or **30 cards** with canonical unique printed slots, unique physical IDs, valid eight-category quotas. All printed slots belong to the canonical board. Any partial 1–29 or >30 board is invalid.
- Public character assignments are either absent with null hearts for each actor or complete with unique character/actor IDs, 1–5 hearts matching the player and a matching physical starting activity at their lot. This does not verify private action hands, factions, special powers or the unused draw pile.
- The **gross, unpaid** salary quote list must equal the independent `GrossSalaryRules.Quote` calculation in canonical seat order (2 base +1 per controlled standing henchman). No payroll is processed, no tax or win score introduced.
- The checker is a pure Domain function; it does not mutate match state or add API routes. The Development bearer lock/no-store model and Production disabled API remain unchanged.

## Tests and release gate

- xUnit 2/4/8 valid slot-only, card-only, character-only and full-deck fixtures, genesis through movement/turn end, verified frames, gross-only quotes and encrypted checkpoint roundtrip.
- xUnit tamper table falsifies wallet/tokens/henchmen, owner/lot/posture, partial/duplicate/quota-shifted cards, character assignment/hearts and salary amount/order/membership. Failed replay contains no prefix frames or hand details. Existing movement-specific error codes retained.
- xUnit `WebApplicationFactory` for true Development `/audit` + `/history` 2/4/8: bearer, no-store, read-only genesis, revision & frame parity, after move/settlement, revoked tokens denied, Production 404.
- Playwright live React vs actual ASP.NET Core API 2/8: compare the certified public genesis/history to the real public snapshot, wallet & quote without any new mutation. Existing mocked browser and Vite suites stay mandatory.
- Tracked as GitHub issue #161, under parent #6. **Close only on 3/3 GitHub Actions success for the exact HEAD commit on main.** Blockers #4/#7/#8/#13/#19 are still open; the #160 ledger is synchronized to its previous exact CI #43957397069, 1,380/1,380.
