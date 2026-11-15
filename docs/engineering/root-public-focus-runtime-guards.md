# Fail-closed root tactical and historical overlays (#110)

The React root receives public Development match data, but TypeScript's
`PublicMatchSceneState` annotations cannot validate runtime JSON. Tactical
and historical focus selectors run **during render**, before the independently
guarded #108 city pawn and controlled-lot markers. Null player/card/control
records and missing arrays must not crash the app or paint fabricated targets.

`verifiedTacticalFocus` requires one canonical, unique nonempty public
`playerId`/known road per player, a well-formed array of public cards with
existing printed slots and real nonempty ID/category, and controls whose
slot/card/known owner/posture are consistent and unique. It then independently
checks match+revision, actor ID, a different known player / uncontrolled valid
card / rival-controlled valid lot, and the exact canonical shortest path
from the actor's current public street. No invalid target, missing board
card, unknown owner, duplicate public player/slot, malformed input, or
stale focus is retained. For a well-formed genuine focus the return copies
and freezes its canonical route, and remains **display-only**.

`verifiedHistoricalStreetFocus` checks only the independently relevant
public player/known-road snapshot and its replay revision, match, player,
history revision and canonical target road. Invalid/null/duplicate players
fail closed without exception; invalid *unrelated* board/control records do
not remove otherwise legitimate history inspection. The lab still validates
history against the actor-bound public timeline; these selectors never
replay .NET game rules or establish command permission.

Deterministic Playwright tests import the *real* TS modules through Vite:
valid player/activity/rival-lot/history focus for **2/4/8** seats,
17 forged public snapshot variants per size, seven forged focus variants,
malformed array/record/null containers and forged history request revisions.
Existing mocked browser 2-seat overlays and **real .NET two-bearer** history,
token and route suites, plus xUnit, remain unchanged. Closing requires all
**3 CI jobs completed/success on the exact latest main SHA**, and updating
AGENTS, patch notes, ledger and issue.

[Issue #110](https://github.com/KeyserDSoze/Game.Edonism/issues/110)
