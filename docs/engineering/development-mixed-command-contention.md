# Mixed Development command contention — #77

**Target 0.0.2; parent #6; follow-up #76.** This tranche proves that the single-process Development per-match lock serializes two *different* commands that are both valid for the current actor at the same revision: `free-move` and `end-turn`. It does not introduce Production identity (#13), a new gameplay action, settlement, cards or election behavior.

## Race matrix

Seven `WebApplicationFactory<Program>` theory cases cover **2–8 seats** with distinct bearer capabilities and independent HTTP clients. On every actor's first-round turn the test releases the following requests through one barrier, all with the same `expectedRevision`:

- the active seat's `free-move` toward the first canonical neighbor from `BoardCatalog.LoadDefault()`;
- the active seat's `end-turn`;
- one `end-turn` from every opponent.

The scheduler is deliberately unconstrained. Exactly one request may return HTTP 200; all other requests must fail closed with HTTP 409, `Cache-Control: no-store`, no capability data, and only the existing `not_your_turn` / `revision_conflict` error codes.

## Accepted branches

If `end-turn` wins, the active player does not move and the turn advances exactly once. If `free-move` wins, only that player moves one canonical street edge, `freeMoveUsed` becomes true, and the same player remains active; the test then sends one ordinary `end-turn` at the new revision to normalize the turn boundary.

After either branch, all authenticated seats must read a byte-identical public snapshot, revision and event counts must be exact, the independent `/audit` projection must remain valid, and atoms/diplomacy/henchman resources must be unchanged. The last seat ends in `AwaitingRoundSettlement`; later commands remain rejected without mutation.

## Gates

The dedicated xUnit HTTP matrix plus the existing mocked Playwright UI and real-.NET Playwright suites must all pass **3/3 on the exact final `main` HEAD** before #77 closes. This is a single-process Development concurrency guarantee only; it does not claim distributed consistency or Production authentication.

[Tracking issue #77](https://github.com/KeyserDSoze/Game.Edonism/issues/77).
