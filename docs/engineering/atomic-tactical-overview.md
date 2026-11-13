# Atomic public PvP tactical overview (#87)

The first-round Development laboratory currently obtains three independent actor-bound tactical perspectives: uncontrolled activity cards (#49), other players (#51) and lots controlled by those players (#84). Even though the browser guards each result against its current snapshot revision, three separate reads can finish at different live revisions. A new **additive** server contract packages all three existing read-only public projections from the **same match lock**.

## Contract

`GET /api/dev/matches/{matchId}/tactical-overview` exists **only** in ASP.NET Core Development. It requires the current `X-Edonism-Dev-Token` bearer; the store resolves the actor under the same per-match lock used for mutations. Invalid, absent, forged or rotated credentials return the same generic 404 and inherit `Cache-Control: no-store`. Query/body `playerId` is never authority.

The response has `matchId`, `playerId`, `round`, `verifiedRevision`, `fromStreetId` and three exact existing typed sub-projections: `uncontrolled` (public placed card ID/category and street path), `otherPlayers` (opponent seat, street, public owned/standing counts and path), and `opponentControlledLots` (public slot, other owner, posture and path). The Domain separately verifies the supported public first-round audit before each projection and checks that **all three nested scopes** agree with the current snapshot. Their nested route arrays are immutable copies, not a new unchecked view or user-provided state.

Reading does not change round, revision, events, control, wallets, hands, checkpoints or long-poll notifications. No combat, purchases, turn estimates, taxes or salary are inferred. The five topology connections inferred from imagery still require #4 designer confirmation. This is not Production identity or multi-instance consistency (#13).

## Compatibility and test plan

The original three endpoints remain compatible; **React now reads the one atomic endpoint** as tracked under [#88](https://github.com/KeyserDSoze/Game.Edonism/issues/88). One actor-/bearer-/revision-scoped request replaces three independently timed browser fetches. The client continues the original strict #49/#51/#84 checks, now **all-or-nothing**: every nested path, card, owner, posture, count, ordering and scope must agree before any list is committed. A partial/corrupt result yields no tactical panel and clears read-only focus; stale responses after a seat, token, revision or match change are ignored. The #85 nearby filter acts only on the resulting validated opponent lots. Rotated and revoked bearer 404 processing retains the existing race guard. Mocked and real-API Playwright verify one request per seat/revision, original endpoints unused by the client, 2/8 seats, remote movement, token rotation and mobile IT/EN compatibility.

xUnit checks 2–8 seats, public-only immutable copies, parity with all existing Domain methods, free move, pending settlement and checkpoint restoration. ASP.NET integration tests check 2/4/8 independently authenticated seats, generic 404, no-store, query spoofing, token rotation and Production absence; the body is compared to all three independent endpoints at the same fixed revision. Mock Playwright guards legacy panel behavior while live Playwright verifies the new endpoint against the real .NET API and unchanged public snapshot.

Track [#87](https://github.com/KeyserDSoze/Game.Edonism/issues/87); close only after all 3 GitHub Actions gates succeed on exact final `main` HEAD.
