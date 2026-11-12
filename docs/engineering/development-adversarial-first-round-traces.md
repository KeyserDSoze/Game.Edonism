# Deterministic adversarial first-round PvP traces — #75

Target version: **0.0.2**, subtask of #6. The Domain still implements only initial setup, one free adjacent-street move per actor and end-turn; it **does not** resolve salary, tax, card effects, reactions, elections or subsequent rounds.

## Deterministic xUnit matrix

`FirstRoundAdversarialTraceTests` generates **21 independent test cases**: player counts 2–8 inclusive, each paired with the fixed RNG seeds 13, 73 and 233. The PRNG shuffles distinct preconfigured Development starting lots and chooses whether each actor makes a legal canonical graph move before ending their turn. The fixture is repeatable by seat count and seed. No character/deck metadata is treated as an official catalog.

Each turn injects wrong-actor attempts to move/end, a nonexistent street and a self-street destination. After an accepted free move it injects the previous revision and a second free move. Every rejected command must return the known Domain error code **and the exact same JSON of the public snapshot as before** (revisions, events, order, players, economy, controlled activities, quotes, and all public fields). Accepted commands must advance the revision by exactly one; independent `MatchAuditReplay.Verify` must agree with all public positions, used flags, phase and current player.

At the end every actor has completed their turn, the final event is `round-settlement-pending`, all wallets and initial henchmen allocations are unchanged, the proposed next order starts with the former last seat, and no command can advance another round. The trusted checkpoint is restored; its public state and replay must match the source and commands stay blocked in pending. No private cards are added to snapshots or HTTP.

## CI and boundaries

The test exercises Domain command invariants, **not** live concurrent network scheduling, Production authorization or game-design decisions R-07/R-09. The existing `DevelopmentMatchStore` authorization tests, full React/Playwright UI and real .NET API Playwright remain mandatory CI checks. The issue may be closed only after the final documentation commit's **same SHA** on `main` passes all three GitHub Actions jobs.

Tracking: [#75](https://github.com/KeyserDSoze/Game.Edonism/issues/75).
