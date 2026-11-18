# #167 — Public per-street plurality (scouting, not rules)

## Source and scope

This Development/public city read-only helper is a **comparison**, not ownership or legal control of a street. The printed board includes 30 placed activities across 7 streets (Main Square has no activity lots). The existing verified server-side first-round territory report (#158) and the React full-board matrix (#152) already publish per-street, per-seat owned lots and standing/fallen henchmen. #167 does **not** add a mayor, faction, influence, turn action, power, attack range, purchase permission, salary credit, scoring or victory outcome.

`verifiedPublicStreetPlurality(snapshot)` consumes **only** `verifiedPublicStreetControlMatrix(snapshot)`: it does not accept injected preverified rows and never computes from a selected or filtered road. An invalid, incomplete or forged public snapshot returns `[]` for the **entire 7-road result**. A valid road with zero controlled activities returns `{ maxControlled: 0, leaders: [] }`, distinct from an unverified city. A road with positive controlled lots reports every seat whose count equals the highest count, preserving the complete authoritative roster order. Standing/fallen posture is included on the existing owner rows but does not affect who has the most controlled lots.

The existing public road atlas lists a short, localized comparison next to the actual verified per-road owners: **largest count and all joint leaders**, or an explicit no-leader line on an empty street. Labels say this is not a victory, and the UI exposes no secret hands, faction, vote, credentials, hidden deck, new server route or command. Street-specific `data-testid`/count attributes support non-flaky DOM assertions.

## Evidence and tests

- Playwright imports the **actual Vite TypeScript modules** in Chromium with 2, 4 and 8 public seats. Uses a complete 30-slot/8-category printed-quota synthetic board. Asserts exactly seven streets, full positive ties in original seat order (including one fallen scagnozzo), solo maxima after a new synthetic public lot, zero-lot roads including Main Square, pending settlement parity, and fail-closed responses to forged owners, card IDs, missing cards, duplicate seats, invalid postures and foreign streets. It asserts no secret fields appear in output and no fixture mutation.
- xUnit constructs a real 2/4/8-seat .NET full-deck match, calls the **audit-verified public territory** projection and checks the same totals, roster ordering, posture conservation and no private payload. The public report must remain unchanged after an authorized free-move; movement changes a pawn's street but never owned lot.
- The checks are not a browser replay of actual purchase/settlement. Original card assets remain blocked by #19 and the printed effect/action engine by #7/#8. Close #167 only with all three **exact-head** CI jobs successful and link evidence in the issue and ledger.

See issues [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6), [#8](https://github.com/KeyserDSoze/Game.Edonism/issues/8), [#152](https://github.com/KeyserDSoze/Game.Edonism/issues/152), [#158](https://github.com/KeyserDSoze/Game.Edonism/issues/158) and [#167](https://github.com/KeyserDSoze/Game.Edonism/issues/167).
