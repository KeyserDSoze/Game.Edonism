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

## Public controller filtering (#89)

The browser may further filter the **fully accepted** `opponentControlledLots.routes` from #88 by `ownerPlayerId`, using only an owner in the *same* accepted `otherPlayers.others`. The optional proximity setting (#85) is intersected with this predicate; neither preference changes the underlying route order, verified revision or audit. The owner menu defaults to all other seats, never the current seat, and resets on match/actor/token changes, including rotation. Empty or missing targets are displayed as empty states, not interpreted as absence of combat opportunities or a faction. Changes clear any now-stale public map focus and require **zero extra API reads or gameplay commands**.

The graph remains versioned Development topology, including #4 pending inferred edges. Tests: xUnit 2/4/8 all authorized opponent owners with independent slot/path grouping and unchanged checkpoint; browser mock mobile IT/EN, 8-seat owner with no lots, near/owner combination, tampered atomic failure, token revocation; real .NET API verifies browser-only filter and unmodified match/audit after rotation. [Tracking #89](https://github.com/KeyserDSoze/Game.Edonism/issues/89).

## Nearest verified public lot by rival (#90)

Within the #89-filtered, fully validated opponent-controlled lots, a second display-only summary shows one entry per already verified other seat from `otherPlayers.others`, with the first visible lot for that owner or a translated explicit empty state. Since #88 verifies server sorting by `streetSteps`, `ownerPlayerId` and `slotId`, filtering retains stable minimum-distance/tie selection. Even an owner whose publicly owned slots are all excluded by the current near or controller filter is included with a truthful empty entry. Unknown/own actors cannot enter the summary; the entire panel is hidden if the atomic tactical bundle is rejected.

The existing validated `streetPath` is copied only into **read-only** city tactical map focus; never interpreted as a travel-time, enemy threat, combat range, purchase or card power. The component makes zero extra API requests, preserves IT/EN and mobile/fallback behavior, and clears stale focus on filters, changing actor, secret, or revision. Compare 2/4/8-seat canonical route grouping and tie-break to independent Domain graph paths (including movement/checkpoint restore); mock mobile/IT-EN/forged/seat and token rotation; verify two real isolated browser seats against the real .NET `tactical-overview`, unchanged public snapshot and audit. [Issue #90](https://github.com/KeyserDSoze/Game.Edonism/issues/90).
