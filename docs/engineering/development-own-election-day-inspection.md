# #164 — Actor-bound, read-only Election Day own-hand index

## Rulebook and security boundary

The printed Italian rulebook places one Election Day physical card into the same initial 59-card shuffle as 58 ordinary actions, four private cards dealt per seat. **#163** records the special card's trusted type only in encrypted private Domain v2 checkpoints. Original single-card assets and canonical metadata (#19) have not yet been provided. We can identify the special card **in the requester's own hand** without implementing or guessing an election trigger (R-09) or revealing any private position to another player.

The new **Development-only**, bearer-authorized, no-store `GET /api/dev/matches/{id}/hand/election-day` returns `MatchOwnElectionDayInspection`:
- `matchId`, `playerId` (derived from the bearer), `verifiedRevision` (public audit verified), `classificationAvailable` and `ownHandIndex`.
- `ownHandIndex` is 0–3 when the requester's own private four cards contain the trusted Election Day marker; otherwise **null**. Null is NOT an indication of which other player holds it or whether it is still in the deck.
- For legacy Domain **v1** encrypted checkpoint containing no typed card metadata: `classificationAvailable=false, ownHandIndex=null` explicitly means **unknown**, NOT a confident absence. For v2, `classificationAvailable=true`; null means only “not in this particular actor's own four cards”.
- The payload never includes the raw `ElectionDayCardId`, `cardIds`, `remainingDrawPile`, credentials or hands belonging to others. `GET /hand` and the atomic `GET /seat` response remain unchanged and never expose the typed marker property.
- The Domain verifies the public revision before providing an index and the Development match store resolves the bearer under its per-match lock. 404 for anonymous, forged and revoked credentials; Production endpoint absent.
- React Development highlights only the verified card **in the currently authenticated own hand**, with IT/EN explanatory text **no voting/effect implemented**. The strict Vite validator checks the exact five payload keys (rejects secret marker extras), match, actor, revision, enum, 0–3 index, and four distinct own card IDs. A changed seat/token/round, disconnected/404 source or malformed 200 removes the hint; the UI never guesses card type from the opaque ID or stores this projection. No public board overlay or other-seat inference.
- Still **no voting, mayor, card-play effect, real taxes, election event, action permission or hidden-player inspection**. R-09/#4, PvP politics #8, card catalog #7/#19 and complete Game Engine #6 remain open.

## Test and closure

- xUnit 2/4/8 full-deck: actor-only index matching private hands, special present in own hand/another hand/pile, same location after move/end-turn and encrypted checkpoint restore, explicit v1 unknown, no index for legacy fixture without cards, no change to wallet/audit.
- xUnit WebApplicationFactory Development 2/4/8: real `/hand/election-day` vs same authenticated `/hand`, 404 missing/forged/revoked, bearer rotation, no-store, no secret IDs/pile/token or match mutation, Production 404.
- Playwright mocked React IT/EN/mobile: correct badge and absent/unknown distinctions, switched seats/capabilities, forged player/revision/index/marker extras/503 rejection. Playwright Vite imports the actual validator for 2/4/8 rather than a duplicate test implementation.
- Playwright live against the real .NET API: 2-seat two-browser and 8-seat Alice/Heidi actor-only hint parity, no exposure through public endpoints, no command to vote.
- **Issue-first #164 on `main`**; only close after three GitHub Actions jobs return success on the exact final HEAD SHA. #163 already closed after [CI #44263895697](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/44263895697) — 878 xUnit + 536 mocked React + 42 live = **1,456/1,456 PASS** on `6cedb85`.
