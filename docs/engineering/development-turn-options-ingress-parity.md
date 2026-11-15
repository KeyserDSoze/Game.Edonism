# Development actor-scoped turn-options parity (#117)

## Authority and scope

The .NET 10 `GameMatch.TurnOptionsForActor(actorId)` is the sole server
source for the currently implemented first-round actions: one free street
move and end turn. Its output is **not** a reservation and commands still
recheck the actor, phase and revision under a server lock. A valid return
uses the match/revision/actor and follows two public facts:

- `canEndTurn` is **true** exactly when `phase=0` and
  `activePlayerId === actorId`.
- `freeMoveStreetIds` is **empty** if the actor is not active, the match
  is in `AwaitingRoundSettlement` (phase 1) or the actor already
  used the free move (`freeMoveUsed=true`). An active actor who has
  moved may still end the turn.

Prior to #117, the React `/turn-options` fetch and atomic `/seat`
bootstrap accepted any boolean `canEndTurn` and array of strings as
long as match, actor and revision matched. A malformed-but-HTTP-200
projection could offer another apparent free move after it was already
consumed, or contradict the public active actor. Although the .NET
command itself was still correctly rejected, the browser rendered
misleading buttons, and a joined seat could mount the inconsistent
initial options lease.

## Pure fail-closed cross-check

`hasValidDevelopmentTurnOptions(value, actorId, publicState)` checks
the already-verified public Development snapshot envelope (#112/#113/#116)
and the shape of the untrusted options. It requires exact match ID,
safe server revision parity, an existing actor, typed boolean end-turn,
an array of unique nonblank string destinations, no self-destination
and the two public invariants above. This runs **before** an actor-scoped
options lease is set during `/turn-options` refresh and before initial
private hand/session binding on `/seat`. The refresh also confirms the
current match, actor and bearer still match the pending request.

The browser **never computes adjacency or derives a new legal move**:
the route list comes only from the server. `cityBoard` remains a
rendering reference, not a source of gameplay authorization. The
existing `isMyTurn`, token, revision and `busy` checks still gate
buttons and commands. No token is written to URL, browser storage,
logs, local replay or exported public files.

## Tests

`src/frontend/e2e/verified-development-turn-options.spec.ts` loads
the actual TypeScript helper through Vite in **seven Playwright tests**:
valid 2/4/8 active, inactive, moved and settlement cases, nineteen
forged options/snapshot combinations per seat count, invalid containers
and immutability. The tests make **no copy** of the validator or a new
movement engine.

A full mocked browser test in `development-match.spec.ts` consumes
Alice's legitimate free move to revision **1**, then receives an HTTP
200 `/turn-options` advertising an unauthorized **second** move to
Meson. The browser must preserve the real public position and private
hand while hiding **all** invalid options. After selecting Bob then
Alice, a genuine response restores `canEndTurn` but no free moves;
end-turn moves the match to revision **2** exactly once. The test also
checks bearer privacy, with DOM-only graphics fallback.

The existing .NET xUnit, mocked UI and real .NET one-worker two-browser
Playwright gates remain mandatory. No Production login, wallet, card
effects, elections or settlement transitions are added.

[Issue #117](https://github.com/KeyserDSoze/Game.Edonism/issues/117):
close only after all three jobs pass on the **latest exact main HEAD**.
