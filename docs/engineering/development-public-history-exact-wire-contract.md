# #175 — Exact authenticated Development public history wire contracts

## Existing .NET wire truth

The authenticated, Development-only `GET /api/dev/matches/{matchId}/history` returns the **read-only, Domain-replayed** first-round public history. The real API returns existing records:

- `DevPublicHistory`: exactly three root own JSON keys `matchId`, `verifiedRevision`, `frames`.
- Each `MatchReplayFrame`: exactly six own keys `revision`, `kind`, `actorId`, `phase`, `activePlayerId`, `players`.
- Each `ReplayedMatchPlayer`: exactly three own keys `playerId`, `streetId`, `freeMoveUsed`.

The .NET Domain replay verifies the current public snapshot against first-round audit events and the printed canonical board. The JavaScript `verifiedPublicHistory` in `src/frontend/src/features/matches` already independently reconstructed genesis backwards and all frames forwards, verifying revision, actors, street adjacency, current positions, turn phase and free-move flags for **2–8** seats. Its accepted raw history object is retained in the actor-scoped `historyLease`, shown in the history viewer, and eligible for a public offline audit export.

## #175: missing boundary and fix

The existing semantic replay validator did **not** reject *additional own JSON properties* at the root, frame or seat level. A forged HTTP 200 whose replay was otherwise perfectly coherent could carry `token`, `otherPlayerTokens`, `privateHand`, `futureActions`, `adminActions`, `metadata:null`, etc., which were outside the .NET DTO yet might travel inside retained raw objects and downstream export surfaces. There is **no evidence** that the real .NET API emitted such fields or that the browser could gain a command permission from this; this is defense in depth at an untrusted response boundary.

`verifiedPublicHistory` now performs **exact-own-keys** checks for all three DTO layers, in addition to and ahead of the existing all-events replay. It rejects the **entire response** on an over-wide, missing, array or null record at any depth; it never strips or normalizes unknown fields and never projects an invented subset. Key insertion order is irrelevant. The true public audit remains authoritative; no change to Domain commands, creator credentials, per-actor hand, legal streets, salary/settlement or Production identity/persistence.

The UI behavior is unchanged for genuine results. Malformed histories show **unavailable** and disable public replay export while leaving the independently verified match snapshot, private hand and actual server-verified turn commands intact. A new actor-scoped GET with genuine history can recover the viewer; stale/rotated actor scopes cannot publish previously returned history.

## Tests

- **Playwright actual Vite source:** `src/frontend/e2e/verified-public-history-wire.spec.ts` imports the shipped verifier for 2/4/8 owners and first/mid/pending first-round states, valid out-of-order JSON keys and non-ASCII IDs, plus malformed/missing/extra root, genesis/intermediate/final frame, first/last seat, false/null metadata and input immutability. It does **not** implement a separate copy of the verifier.
- **Playwright full React UI against mocked HTTP:** `src/frontend/e2e/development-match.spec.ts` injects one genuine-chronology-but-over-wide authenticated `GET /history` HTTP 200 at revision #2 with an extra root, intermediate-frame or nested private seat key. Every variant prevents replay/export, preserves the hand and server-granted turn, and recovers after a valid next actor read without sending unauthorized commands. No secret marker enters DOM/URL/storage.
- **xUnit real ASP.NET Core API:** `DevelopmentPublicHistoryExactWireAfterRotationTests` exercises 2/4/8 full-deck matches through free-move and end-turn, checks every raw root/frame/seat JSON key, replay actor/phase/position, no-store and absence of token/hand/future power fields. After rotating another actor's bearer, old bearer is rejected while renewed and unrelated actors see the **identical public history**, including when both hold different private cards; Production 404. Existing `DevelopmentHistoryEndpointTests` already check initial/complete histories for all 2–8 seats and require no duplicate tests.

Track [#175](https://github.com/KeyserDSoze/Game.Edonism/issues/175), parent [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6) and [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13). Close only after the exact latest **`main` SHA** has all three GitHub Actions jobs (`.NET 10 / xUnit`, `React / Playwright`, `Live React + .NET / Playwright`) **completed/success**; #174 previously closed with 1,559/1,559 on `a136826`. No new gameplay rule.
