# #178 — Exact HTTP JSON wire contract for public tactical overview

## Defect and trusted source

The Development-only `GET /api/dev/matches/{id}/tactical-overview` combines three server-audited read-only projections. Existing #100 scope checks and #101 route/owner/board checks verify all public values, but until #178 they accepted **extra raw JSON own properties**. An otherwise coherent forged 200 containing `privateHand:null`, `futureEffects:false`, `otherPlayerTokens` or unexpected metadata could enter `tacticalLease` even though those fields are not emitted by the .NET DTOs. This is a client boundary hardening step; **no private leak has been observed from the real API**.

## Shape contract (own enumerable JSON keys)

.NET Domain record types are the source of truth; JSON serialization camel-cases their properties:

| Layer | DTO | Exact keys |
|---|---|---|
| Root (8) | `MatchTacticalOverview` | `matchId, playerId, round, verifiedRevision, fromStreetId, uncontrolled, otherPlayers, opponentControlledLots` |
| Nested (6) | `MatchUncontrolledRoutes` | `matchId, playerId, round, verifiedRevision, fromStreetId, routes` |
| Nested (6) | `MatchOtherPlayerRoutes` | `matchId, playerId, round, verifiedRevision, fromStreetId, others` |
| Nested (6) | `MatchOpponentControlledLotRoutes` | `matchId, playerId, round, verifiedRevision, fromStreetId, routes` |
| Route (6) | `MatchUncontrolledRoute` | `slotId, cardId, category, streetId, streetSteps, streetPath` |
| Row (6) | `MatchOtherPlayerRoute` | `otherPlayerId, streetId, streetSteps, streetPath, controlledActivities, standingHenchmen` |
| Route (6) | `MatchOpponentControlledLotRoute` | `slotId, ownerPlayerId, posture, streetId, streetSteps, streetPath` |

The pure `hasExactPublicTacticalOverviewWire` checks all seven layers, including **every** row, before the old semantic checks and before React leases the raw object. It rejects extra/missing properties even if their value is `null` or `false`, and wrong object/list shapes. The wire guard does **not** decide route validity: #100 still binds current actor/match/revision/origin and #101 recomputes canonical paths, public player/lot/card rosters, posture and ordering. No keys are dropped, filtered, or copied into a permissive partial view.

All tactical panels, owner/street filters and map focus remain unavailable when any layer is forged. The browser does not infer command permissions from a successful advisory projection; only authenticated .NET Domain commands grant free moves/end turns. Previous actor/revision/abort checks and nonrevoking malformed-response behavior remain unchanged. No new economy, card, mayor, PvP victory or Production authentication logic.

## Verification

- `src/frontend/e2e/verified-public-tactical-overview-wire.spec.ts`: real Vite-transformed guard with 2/4/8 actors, all seven layer targets for added `null`/`false` and missing keys, null/array/wrong-row shapes, original payload immutability.
- Mocked React E2E: forged plausible root, uncontrolled-row and opponent-row HTTP 200; all tactical views fail closed without commands or bearer revocation; a subsequent independent seat switch recovers with a good 200. Pre-existing route/path semantic tests still run.
- xUnit WebApplicationFactory Development 2/4/8: exact root, nested projection and every row's JSON keys, canonical per-actor scope, no-store; existing endpoint tests cover revoked/forged bearers, Production 404, absence of secrets, unchanged match/audit and token rotation.
- CI: unchanged .NET 10/xUnit, React Playwright, React + real .NET Playwright jobs; #177 discovery gates remain enabled. Do not close #178 until all three are completed/success on the **exact latest main SHA**.

Related: [#178](https://github.com/KeyserDSoze/Game.Edonism/issues/178), [#100](https://github.com/KeyserDSoze/Game.Edonism/issues/100), [#101](https://github.com/KeyserDSoze/Game.Edonism/issues/101), parents [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6) and [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13).
