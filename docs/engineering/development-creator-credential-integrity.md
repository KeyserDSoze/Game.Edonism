# Development creator credential integrity (#114)

The Development create endpoint `/api/dev/matches/from-full-deck` returns
a public, server-authored match snapshot **and** per-seat capability tokens.
A TypeScript cast is not runtime validation. Prior to #114 the browser
confirmed the public snapshot and number/identity of seats, but never checked
the token string itself or uniqueness between seats before assigning
`currentActorScope`, revision and session state. A forged HTTP response
with two identical bearers, a missing token or a non-hex token could be
accepted, exposing an apparently authenticated local game seat that .NET
could not authorize. The separate Development join form already required a
64-character hex token, as does seat-token rotation.

`hasValidDevelopmentCreatorResponse(value, requestedSeatIds)` is a pure,
all-or-nothing **Development-only** validation step. It requires a canonical
UUID match ID; a well-typed public snapshot using #112/#113's envelope with
the same match ID; 2–8 unique requested seat IDs matching all public
players exactly; an exact credential record for every declared player; and
one 64-character hexadecimal token per credential. All tokens are compared
case-insensitively to reject duplicates, even if the representations differ
only in uppercase. No credential is printed, stored in browser storage,
logged or used as gameplay authorization merely because it passes the
client-side shape guard. .NET remains authoritative for bearer binding.

This validation runs before updating the creator's in-memory actor scope,
session or revision and before private-hand retrieval. Invalid responses
enter the existing create-error state without creating a local session.
The accepted 2–8-player Development flow is unchanged. The mocked browser
test tokens now use `a,b,c,d,e,f,0,1` repeated 64 times for eight seats,
so every synthetic bearer matches the same format already required by
Development join; this does not claim any secret is safe for production.

Seven Playwright tests import the real Vite TypeScript validator: valid
2/4/8 seat creation responses; 18 forged credential, token, mismatch,
match-ID or public-seat cases for each size; and malformed containers.
A full mocked browser regression first replies with duplicate Alice/Bob
bearers and confirms no actor session, revision, private hand or authorized
requests are accepted. A second valid reply creates an eight-seat match,
lets Heidi select her own hand and verifies tokens never appear in page
text. All 665+ xUnit, mocked Playwright and real .NET two-bearer Playwright
tests must stay green **3/3 on exact final main HEAD** before closing.

[Issue #114](https://github.com/KeyserDSoze/Game.Edonism/issues/114)
