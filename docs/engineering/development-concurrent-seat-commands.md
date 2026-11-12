# Concurrent Development seat command contention — #76

**Target 0.0.2; parent #6.** After #75's deterministic single-process Domain traces, this tranche exercises the actual ASP.NET Core Development-only HTTP boundary, multiple independently issued bearer capabilities and the per-match lock. It neither implements nor claims Production authentication (#13).

## Integration matrix
Seven xUnit `WebApplicationFactory<Program>` theory cases (2–8 seats). Every case creates distinct participants in canonical printed-board slots through the existing Development fixture creator. Each seat owns a separate HTTP client and bearer token.

On each first-round actor's turn, a `TaskCompletionSource` releases N+1 HTTP POSTs for the **same** expected revision: one from every seat and a second from the active actor. The scheduler may choose different orderings; the invariant is always **exactly one HTTP 200** and N **409** with only `not_your_turn` or `revision_conflict`. HTTP `no-store` remains obligatory for both outcomes, and no credential appears in either response.

After each burst, all authenticated seats must read byte-identical public snapshots with one extra revision, one extra event attributed to the expected actor, unchanged financial/henchmen resources and no free-move activity. The independently verified `/audit` projection must agree with the committed revision. After the final seat, the match remains pending, all further end-turn commands return 409 without mutation, and the next player is null.

Anonymous audit reads get 404. Rotating one credential revokes the old bearer without changing the public state; the replacement still reads the same state. These checks do **not** grant Production identity or prove distributed multi-instance consistency; the Development store is single-process and in-memory by default.

## Gates
xUnit .NET 10 plus the existing mocked Playwright UI and real .NET Playwright must pass 3/3 on the exact final `main` HEAD, with issue closure noting the SHA and run. No gameplay actions, routes or DTOs are introduced.

[Tracking #76](https://github.com/KeyserDSoze/Game.Edonism/issues/76).
