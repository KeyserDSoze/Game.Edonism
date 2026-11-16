# Public PvP economic scouting in city roster (#138)

## Existing authoritative data

Development `.NET 10` `GameMatch.Snapshot()` already exposes
`ControlledActivities` (public owner, canonical lot, standing/fallen)
and `GrossSalaryQuotes` (base atoms, standing contribution, gross atoms).
The Domain `GrossSalaryRules.Quote` is the ONLY authority for calculating
2 base + one per upright controlled henchman, as the printed first-round
Development gross PRE-TAX quote. The prototype does **not** award salary,
settle the round, calculate taxes, transfer wallets, buy lots or attack.

The city previously rendered these public projections only in the
separate controlled-activity roster, not alongside rival pawn positions.
This read-only seat summary puts the already-trusted values beside the
player's current server-confirmed street and printed character status,
without new server requests or a client-side game engine.

## Fail-closed public projection

`verifiedPublicSeatEconomy(unknown)` reuses:
- `publicGrossSalaryQuotes` (#105/#107), which rejects malformed,
  incomplete or forged 2–8-seat quote sets; it validates the existing
  printed-catalog card/lot/owner/posture records and gross arithmetic
  by comparison to canonical standing ownership;
- `controlledLotMarkers`, which binds printable card IDs, valid lots
  and genuine public owners;
- `playerMarkerPlacements`, which refuses to make up a street and
  suppresses duplicate player IDs; canonical `MatchParticipantId`
  technical ID rules apply.

If any player marker is missing, any quote is absent, or any control
is unrenderable, the ENTIRE summary is empty. On success, the helper
counts public controlled lots / standing / fallen per confirmed owner
and **copies** `grossAtoms` from the already-validated server quote.
It does NOT recalculate a salary or grant an API command. Seats with no
controlled lots get counts 0/0/0 and the original 2-atom base quote.

Each player row has a readable IT/EN accessible text and stable
`data-*` attributes, not a combat target or a transaction.

## Regression gate

- .NET xUnit Theory 2/4/8: real server initial per-seat quote and
  public lot/posture, no wallet credit or change after a legal move/end.
- Real TypeScript through Vite Playwright 2/4/8: one standing/fallen
  lot per seat; 2-atom zero-lot quote; immutability; fail-closed
  forged quote, missing lot/card, duplicate/foreign owner/slot, posture
  corruption, malformed player/quote/container.
- Mocked real React Playwright 2/8, standing/fallen, mobile/no WebGL,
  language switch, live-looking movement, seat switch and leave;
  inconsistent economic input hides all rows without disabling turn.
- Live browser + actual .NET API, two and eight seats: every public
  summary agrees with the server's public quote and controlled
  henchman records before/after a move.

Issue [#138](https://github.com/KeyserDSoze/Game.Edonism/issues/138).
0.0.2 Development only, direct `main`; close after all 3 GitHub CI
jobs pass on the exact final HEAD.
