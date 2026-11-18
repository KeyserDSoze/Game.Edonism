# #174 — Exact root for authenticated Development atomic seat bootstrap

## Authoritative wire schema

`GET /api/dev/matches/{matchId}/seat` is a bearer-authenticated Development-only **atomic** projection from one server match lock. The .NET API returns exactly five root JSON properties of the existing `DevSeatBootstrap` record: `matchId`, `playerId`, `state`, `hand`, `turnOptions`. The public `state`, actor-private `hand` and actor-scoped read-only `turnOptions` all refer to the **same** match and revision. The HTTP result is `no-store` and the bearer token is never serialized into this response.

Before #174, `DevelopmentMatchLab.joinDemo()` already validated the public envelope/audit chronology (#112+), private first-round hand (#166), actor turn options (#170), and root/nested match and owner/revision agreement. It destructured the raw root object **without checking its exact field set**. An otherwise valid forged HTTP 200 containing unknown root keys such as `otherPlayerTokens`, `credentials`, `adminActions`, `futureActions`, `secret`, `privateHand` or even `metadata:null` could therefore pass the inner checks. The UI only copied the expected properties to session state, so this is **client defense-in-depth**, not evidence of a real .NET API leak or server authorization bypass.

## Client behavior

The pure guard `hasValidDevelopmentSeatBootstrapEnvelope(candidate, requestedMatchId)` executes **before** any destructuring/actor binding and requires:

- Exactly five **own enumerable JSON keys** `hand|matchId|playerId|state|turnOptions` (order irrelevant), with no extra or missing keys.
- Requested well-formed match UUID matching the returned match ID case-insensitively (same existing join behavior), valid exact Development technical seat ID (Unicode scalar support, reserved genesis `system` rejected), and non-null **object** values (not arrays) for `state`, `hand` and `turnOptions`.
- The existing independent nested guards **must still** validate the complete public state, actor hand and server-only turn options, and match, turn, revision and actor agreement. The new root guard intentionally does not duplicate these nested checks.
- Reject the **entire** raw response rather than silently stripping injected metadata. On an invalid root, no private session, local bearer binding, hand, map controls or client-issued command is installed. A subsequent valid independent join may succeed; normal actor scopes, token hygiene and the previous 2–8 seat rules remain.

This does not grant PvP commands, alter .NET DTOs or modify authentication. Production identity/persistence remains tracked in [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13).

## Test coverage

- **Actual Vite module**: `src/frontend/e2e/verified-development-seat-bootstrap-envelope.spec.ts` loads the real guard for 2/4/8 technical owners, including Unicode and correctly serialized UUIDs; checks valid reordered root keys, unknown properties (including null/false), missing fields, malformed match/actor and null/array nested roots, plus input immutability.
- **Actual React UI with forged HTTP**: `src/frontend/e2e/development-match.spec.ts` injects an extra `otherPlayerTokens` root key into an otherwise valid authenticated `GET /seat`. It checks no session, private hand or commands are installed and no secret reaches DOM/URL/storage. A genuine repeat GET with the same actor bearer completes the atomic private bootstrap without fake metadata.
- **Real .NET API xUnit WebApplicationFactory**: `DevelopmentSeatBootstrapPostRotationExactWireTests` covers 2/4/8 seat games **after** a turn advance and a private bearer rotation (different from the initial-exact-wire test already added for #170). Enforces five-key root, one actor's hand/options at revision 1, no-store, old token and anonymous denied, unrelated actor unaffected, no bearer or extra credential metadata, Production 404.

Track [#174](https://github.com/KeyserDSoze/Game.Edonism/issues/174) and parent [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6)/[#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13). Close only after `.NET 10/xUnit`, `React/Playwright` and `Live React+.NET/Playwright` all complete **success** on the **exact latest main SHA**. Never cancel a still-running previous SHA CI with an extra push.
