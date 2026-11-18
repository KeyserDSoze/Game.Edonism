# #166 — Strict Development private-hand wire admission

## Verified boundary

The server emits `MatchPrivateHandSnapshot` as the actor-scoped `GET /api/dev/matches/{id}/hand` response and as `hand` inside bearer-authorized atomic `GET /api/dev/matches/{id}/seat`. That contract has **exactly three** JSON properties: `matchId`, `playerId`, `cardIds`. Each Development full-deck player has four opaque unique cards; this is not a Production hand or a rule authorizing future card play.

Before #166 the client helper checked four unique nonblank card strings, actor and match, but accepted arbitrary additional properties. `DevelopmentMatchLab` stores an accepted hand object directly in React state, so an attacker-forged HTTP 200 with unexpected `remainingDrawPile`, `electionDayCardId`, `otherPlayerCardIds`, `credentials`, `token` or other properties could be retained. **This is defense-in-depth against a forged frontend response**, not evidence that the real .NET endpoint leaks these fields.

## Behavior

- `hasValidDevelopmentFirstRoundHand` rejects any object with fields other than `cardIds`, `matchId`, `playerId`; unknown extra fields are never stripped to make the response appear trusted.
- It requires an expected actor accepted by the shared `isValidDevelopmentTechnicalPlayerId` (#127/#128), then exact case-sensitive equality to the returned actor. The selected match must match exactly; keep the four distinct, nonblank opaque card IDs and avoid guessing official card types.
- The same helper is used on standalone authenticated reads and the initial atomic `/seat` bootstrap, so no new API route, credential storage or private-state projection is required.
- This does **not** modify the .NET API surface, the current card distribution, special Election Day visibility (#163/#164), turn progression, Production authentication or real gameplay.

## Regression matrix

- Browser Playwright imports the real Vite TypeScript helper for 2/4/8 seats with printable Unicode actors. Rejects eight types of unexpected fields; missing or malformed keys/card IDs, wrong actor/match, reserved `system`, Unicode controls/bidi, isolated surrogate and overlong IDs. Verifies input fixtures are not mutated.
- .NET xUnit WebApplicationFactory runs real Development `GET /hand` and `GET /seat` for all 2/4/8 bearer seats. Checks the **exact three own-hand keys**, token-authoritative owner despite adversarial query parameter, four unique private cards with no cross-seat reuse, no-store, no raw capabilities or private deck metadata. Rejects anonymous hand reads and Production routes.
- Existing mocked React and live React + .NET suites remain required. Close issue only when **all three GitHub Actions jobs succeed on the exact final SHA**, update ledger and record evidence in #166 and parent #6. #13 real identity and #19 original assets are still open.

Related issues: [#118](https://github.com/KeyserDSoze/Game.Edonism/issues/118), [#164](https://github.com/KeyserDSoze/Game.Edonism/issues/164), [#165](https://github.com/KeyserDSo/Game.Edonism/issues/165), [#166](https://github.com/KeyserDSoze/Game.Edonism/issues/166).
