# Development seat rotation versus commands (#79)

This is a **single-process Development** concurrency contract for the current first-round `free-move` and `end-turn` commands. It does not implement Production identity (#13) or any additional gameplay.

The command's HTTP preflight authorization and the subsequent Store reauthorization deliberately use separate checks. A seat can rotate its bearer between them. Both `TryRotateSeatToken` and the authoritative command execute under the **same per-match lock**. Therefore a concurrent rotation and old-bearer command have exactly two legal outcomes:

- **Command first:** it succeeds once, revision and audit each advance once; rotation revokes the old bearer. With the original `Idempotency-Key`, the new bearer gets a safe idempotent replay.
- **Rotation first:** the command fails with generic 404 even if its preliminary HTTP authorization had succeeded; revision and receipt stay unchanged. The new bearer can submit the same intent and UUID once.

Both outcomes retain private seat boundaries. The old bearer always loses access; other seats keep their own credentials and see the same public snapshot. Wallets and henchmen stay unchanged, and the public audit remains verifiable. Unrelated Production/settlement/election behavior stays out of scope.

The HTTP xUnit matrix covers **2–8 seats × 2 command kinds** with distinct clients and a simultaneous release barrier; no ordering assumption is made. It is gated by full xUnit, Playwright UI mocked and Playwright live with real .NET, on the final `main` HEAD.

[Issue #79](https://github.com/KeyserDSoze/Game.Edonism/issues/79).
