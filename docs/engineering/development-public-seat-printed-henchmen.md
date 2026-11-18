# #168 — Printed 16-henchman budget parity at the public PvP read boundary

## Existing printed rule and trust boundary

The latest printed Italian rulebook (rulebook2 pp.3–4) allocates **16 henchmen for each player color**. In the implemented first-round Domain, `GameMatch` creates `HenchmenTotal=16` and the read-only `GrossSalaryRules.Quote` checks `HenchmenTotal == 16` for every seat. One publicly controlled activity requires one deployed henchman; `HenchmenAvailable = 16 - controlled lots`. This is an existing source-backed rule, **not** a new power, draw, purchase, recruit mechanic or payout.

Prior to #168, the React display guard `verifiedPublicSeatResources` (#139) required only a nonnegative safe-integer total and checked `total - available = verified public controlled lots`. It therefore admitted an internally consistent forged `15/14` or `17/16` display roster for one public lot, or `0/0` for a zero-lot seat, despite the server's canonical budget. This is **frontend defense-in-depth against forged or malformed transport input**, not a claim that the real Development API emits those figures.

## Changes and invariant

The React read-only guard reuses the existing `verifiedPublicSeatEconomy` all-or-nothing roster, card placement, control posture and salary checks, and additionally requires **`player.henchmenTotal === 16` for every seat**. A single forged seat suppresses the **entire** public resource display, not just the offending opponent. The independently verified deployed-lot count must still equal `16 - henchmenAvailable`. Safe integer and nonnegative checks remain for reserve, atoms and diplomacy. A genuine `0` atoms or `0` diplomacy token value remains allowed in read-only transport checks (as do future legitimately changed balances); no invented rule fixes those values to initial game setup. A player controlling zero public lots legitimately has `16/16`.

## Tests and non-goals

- Chromium Playwright imports the *actual Vite module* for 2/4/8 seats. It accepts regular printed-budget rosters and a public zero-lot owner with 16 available, preserves legitimate zero wallet/diplomacy values and printable Unicode player IDs, rejects self-consistent `15/14`, `17/16`, `1/0`, `0/0`, `15/15`, `17/17`, a modified first or last seat and wrong type/fractional/missing total, and verifies no fixture mutation.
- xUnit `PrintedHenchmenBudgetParityTests` exercises the real `GrossSalaryRules.Quote` with 2/4/8 trusted public rosters and corroborates server rejection of 15/17 (including zero-lot 15/15 and 17/17), preservation of true 16/15 and 16/16, and read-only game snapshot/audit invariants.
- Full React and live React+.NET Playwright suites still gate completion, as do all other .NET xUnit tests. Close #168 **only after the three jobs succeed on the final `main` SHA** and add that run to the issue and the ledger. Keep parent #6/#13 open.

No API, persistence, token, client command, salary payout, card rule, election, combat or Production multiplayer change. The user interface still reflects verified public data, not a spendable wallet.

Related: [#139](https://github.com/KeyserDSoze/Game.Edonism/issues/139), [#160](https://github.com/KeyserDSoze/Game.Edonism/issues/160), [#168](https://github.com/KeyserDSoze/Game.Edonism/issues/168).
