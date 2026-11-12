# Development command body limits — #78

**Target 0.0.2; parents #6/#13; follow-up #45/#46/#77.** The two existing Development mutation endpoints accept only tiny JSON DTOs, but a bearer holder is still an untrusted PvP client. Their request bodies are therefore bounded **before ASP.NET Core Minimal API model binding**, without changing any game rule.

## Ordering

For exact POST paths `/api/dev/matches/{matchId}/free-move` and `/end-turn`:

1. resolve the existing Development seat capability first, before inspecting size, JSON or content type;
2. reject a known `Content-Length` above **4 KiB**;
3. otherwise copy at most **4 KiB + 1 byte** into a temporary buffer, so chunked/missing/dishonest lengths cannot cause unbounded application buffering;
4. rewind an accepted buffer and let the normal Minimal API binder deserialize the original bytes;
5. authenticate again inside `DevelopmentMatchStore` under the match lock before applying any command.

Missing, forged and revoked bearers therefore keep the existing generic 404 behavior. An authenticated oversized command returns `413` with only `dev_command_payload_too_large`; the global Development privacy middleware still adds `Cache-Control: no-store`, `Pragma: no-cache` and `Expires: 0`.

## State and idempotency

A 413 never enters `TryFreeMove`/`TryEndTurn`: it cannot advance revision/audit, create an idempotency receipt, heartbeat a seat, wake a gameplay subscriber or expose a hand/token. Reusing the same UUID on a later valid command is therefore legal. Exactly 4 KiB is accepted; the normal binder still decides malformed JSON, media type and DTO shape.

The creator routes retain their independent **128 KiB** limit and rate/capacity admission. Unknown routes, other methods and Production do not use this Development command-body policy.

## Tests

`DevelopmentCommandBodyLimitTests` covers both commands with known-length and unknown-length bodies, exact 4 KiB vs 4 KiB + 1, missing/forged/revoked authorization ordering, no revision/presence mutation, and reuse of an idempotency key after 413. Existing #45 tests continue to cover 400/415 binding semantics and Production absence. Full xUnit, mocked Playwright UI and real-.NET Playwright remain mandatory before closure.

[Tracking issue #78](https://github.com/KeyserDSoze/Game.Edonism/issues/78).
