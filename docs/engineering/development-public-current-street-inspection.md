# Read-only PvP live opponent street inspector (#133)

## Why
The public roster gives each 2–8-seat opponent's server-confirmed **current** street and immutable **starting** activity lot. In the first round, a legal move changes the current street but NOT the lot of origin or controlled activity. #131 and #132 already make origins and public controlled activities independently inspectable. #133 makes the moving pawn's **current street** directly inspectable as well, without navigating manually through seven printed streets.

## Implementation
- Source: **only** `playerMarkers`, the verified public marker output from `playerMarkerPlacements`. That projection omits malformed/duplicate player IDs and unknown/unmapped roads (#108/#109); the browser never invents a road or a fallback player location. The existing public envelope already rejects inconsistent authoritative snapshots.
- In the player's accessible DOM roster, render the street name in a native keyboard-operable `button` with stable `match-inspect-street-<playerId>`, localized `aria-label` (e.g. `Esplora la strada attuale Einstein Avenue di bob` or `Inspect bob’s current street Einstein Avenue`) and `aria-pressed` reflecting **only** `selectedStreetId`.
- Click calls the existing read-only `chooseStreet(marker.streetId)`: this selects the printed road and its initial activity lot for inspection and clears any old tactical/historical overlay. It does NOT submit a move, consume a free action, switch identity or bearer, mutate pawn/controlled lot, change match revision/ETag, expose private hand, or grant gameplay authority.
- After a real .NET move from Gauss to Planck the live street button targets **Planck Avenue**, while the #131 origin button still targets `N-01` on Gauss. Bob's street remains Einstein. Local inspection must never rewrite server-authored public positions.
- Both IT/EN labels, accessible keyboard Enter and 390px no-WebGL mobile fallback are supported. On leaving the match, the public roster and its buttons disappear.

## Regression gates
- Six Playwright tests importing the **actual Vite module** for 2/4/8 seats: every one of the seven canonical roads, case-exact transport, unknown/null/type-mismatched and duplicate IDs, preservation of valid other pawn projections and no input mutation.
- Three full React mocked Playwright tests: 2/8 initial Bob/current Einstein inspect, the difference between Alice's genuine moved Planck street and unchanged starting N-01, no extra POST move/end-turn commands, actor/hand/revision untouched, leave; EN keyboard Enter on 390px browser without WebGL.
- Live React + actual .NET API Playwright: server-issued Bob current street inspection before any command; genuine Alice move updates the street target, only one free move command, and no revision change due to UI-only inspection.
- Three .NET xUnit Domain Theory cases: 2/4/8 current streets always canonical, server-authored free move updates the live street but preserves the originating slot, verified audit after each movement/end-turn, checkpoint restore parity.
- Close #133 only after all three GitHub Actions complete green on **exact final `main` commit SHA**.

Tracking: https://github.com/KeyserDSoze/Game.Edonism/issues/133
