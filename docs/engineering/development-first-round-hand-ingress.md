# First-round Development private hand ingress integrity (#118)

## Authoritative fixture contract

The current .NET 10 Development full-deck fixture (`InitialActionDeckComposer`,
issue #18) deals exactly **four distinct cards per seat without replacement**
from the 58 action cards plus Election Day. The actor-scoped `PrivateHandForActor`
projection contains `matchId`, `playerId` and four private `cardIds`.
Cards are never part of the public match snapshot or public audit. The
server authenticates each seat bearer; this client guard does **not** replace
authorization, card draw, deck composition or card gameplay.

Prior to #118, both the `/hand` read and joined-seat `/seat` bootstrap in
React checked `cardIds` only as an array of strings. A malformed HTTP 200
with duplicate card IDs, an empty card ID, or too few/many cards could mount
and render an impossible-looking private hand (including duplicate React
keys), even though the game engine had not dealt those cards.

## Pure fail-closed runtime validator

`hasValidDevelopmentFirstRoundHand(value, matchId, actorId)` is deliberately
narrow and immutable:

- Require a JSON object, matching exact nonblank match and actor IDs.
- Require `cardIds` as an array of **exactly four** entries.
- Every entry must be a nonblank string; IDs must be unique. Do not
  assume any specific demo ID spelling or expose hidden deck membership.
- Do not log, store, infer, export or transmit tokens/private cards.
- Refuse malformed responses before changing the selected private
  `hand` or before binding an actor/session/option lease during atomic
  `/seat` join. Existing actor/token match checks and abort controllers
  still prevent a delayed old seat's private response from appearing
  after a switch, rotation, local exit or revocation.

A rejected standalone `/hand` response leaves the public match/revision
and server-authorized commands intact; it simply shows the existing private
hand loading/unavailable fallback. A rejected `/seat` response does **not**
establish a session, actor capability or initial hand.

**Scope limit:** exactly four cards is guaranteed only for the *current
Development first-round, unplayed full-deck fixture*. When #4/#6/#7 define
card plays, discards, replacement/draw and later rounds, the server and
client must introduce the proper versioned mutable-hand contract instead
of silently reusing this fixed-size rule. This is not a Production rule.

## Regression tests

`src/frontend/e2e/verified-development-first-round-hand.spec.ts` imports
the actual Vite-loaded pure TypeScript guard in seven Playwright tests.
For 2/4/8 distinct-seat hands, it exercises positive input and negative
match/actor binding, duplicated cards (first/middle/end), missing/excess
cards, null/non-array containers, blank/whitespace/numeric/null IDs, and
untrusted primitives. Inputs are checked for immutability.

Two mocked full-browser tests in `development-match.spec.ts` simulate:

1. Creator switches from valid Alice to Bob and receives a forged HTTP 200
   `/hand` with duplicate Bob cards. The duplicate hand must not render;
   both capabilities and public revision survive. After switching Alice and
   back to Bob, the genuine four-card reply succeeds without exposing
   Alice's cards or tokens.
2. A joined browser receives a forged atomic `/seat` with a duplicate Bob
   card while actor/state/options are otherwise valid. No session, hand
   or private actor is mounted; a subsequent genuine atomic reply accepts
   only Bob and his four distinct cards.

Existing .NET xUnit domain/API and single-worker real-.NET Playwright
suites are mandatory; never weaken retries, timeouts, worker counts or
privacy assertions. No new API, Production identity, salaries, card powers
or game transitions.

[Issue #118](https://github.com/KeyserDSoze/Game.Edonism/issues/118)
requires **3/3 successful CI jobs on exact final main** before closure.
