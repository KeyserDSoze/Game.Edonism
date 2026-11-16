# #160 — Fail-closed gross salary quote input in the .NET Domain

## Why
The server-authoritative GameMatch setup already validated player IDs, printed streets and starting slots; however the reusable `GrossSalaryRules.Quote` previously accepted a one-seat or nine-seat fake roster, reserved audit actor `system`, nonsensical street IDs, duplicate starting slots, negative wallet values, invalid hearts and non-printed henchmen counts. Other internal projections and future persistence paths might pass in untrusted state and mistakenly obtain a plausible public salary quote. A domain quote should never launder that invalid state into trusted economy data.

## Contract
- Validate exactly **2–8** public players, unique `MatchParticipantId.IsValid` technical actor IDs (never `system`), distinct canonical starting slots and a current street on the original 7-road graph. Do **not** infer that a moved player's current street must equal their initial road.
- Each player must have nonnegative atoms and diplomacy tokens, exactly **16** total henchmen with 0–16 remaining, and initial printed character hearts either null for legacy setup or between 1 and 5. Existing checks on unique controlled slot/owner, upright/fallen posture, per-actor deployments and reserves remain.
- **No gameplay change:** gross quote is 2 atoms base +1 for every controlled **standing** henchman. Fallen posture contributes 0. Zero-owned players have a valid base-only quote. It is an informational first-round figure, **not** net salary, tax, a wallet payment, a victory score, or permission to act. Salary application, mayor tax, Innovate, hand refill and later rounds are pending under #6/#7/#8.
- The existing `/settlement-preview` remains Development-only, bearer-authorized and no-store. The quote routine does not add a new route or expose a Production match.
- Tests: xUnit malformed 0/1/9 technical rosters, reserved/bidi/long IDs, duplicate/unknown starting slots, unknown street, negative wallets, invalid 0/6 hearts and forged henchmen totals/reserves; xUnit legitimate zero-controlled player and 2/4/8 full-deck move, end-turn, checkpoint restore, gross quote and no wallet credit; WebApplicationFactory live .NET 2/4/8 pending/settlement status, credential required, full order/quote and no payment; Playwright live 2/8 printed roster and authoritative gross quote invariants.

## Release discipline
Issue-first #160, development directly on `main`; close only after 3/3 GitHub Actions success on exact final SHA. Other printed-rule blockers #4/#6/#7/#8/#13/#19 remain open. The previously completed #159 is synchronized in the ledger with CI #43943038200 (802 + 527 + 42 = 1,371/1,371).
