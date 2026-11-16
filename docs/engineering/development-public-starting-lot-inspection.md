# PvP public starting-lot inspection (#131)

## User problem
The Development public roster introduced in #130 shows each player's immutable originating activity lot (e.g. `N-01`) even after the pawn moves. However, a player comparing 2–8 rivals must otherwise find that lot by hand in the 30-lot city. The city already has an accessible read-only `chooseSlot` viewer affordance that selects a canonical lot and its street.

## Read-only UI behavior
Render a keyboard-accessible native `button` on each **server-verified**, case-exact and unique canonical starting lot from the existing `verifiedPublicStartingLots` helper (which fails closed on all malformed/duplicate origins). Use the existing `chooseSlot` handler on click; it selects the original lot and corresponding printed street in the React board inspector, and clears any stale tactical/historical overlay exactly as manual city inspection already does.

- IT: `Esplora il lotto iniziale N-01 di alice`.
- EN: `Inspect alice’s starting lot N-01`.
- `data-testid="match-inspect-origin-<playerId>"`; `aria-pressed` reflects the *current local inspector selection*, not the game's active seat or turn.

The city inspector and the 3D selection reflect the public printed lot; the visible pawn stays on the **server-authored current street**. This click does not request a backend match command, change session or active seat, mutate a private hand, grant movement, persist focus, transfer ownership or reveal hidden cards/factions. Origin buttons disappear upon leaving the match and remain absent when no valid server-published public scene exists. Native button supports keyboard Enter/Space and small mobile screens or no WebGL.

## Tests
- Three real-Vite Playwright tests for 2/4/8: actual shared 30-lot board mapping, allowed canonical origin target, no false position relation, invalid origin suppresses all public buttons, immutability.
- Three full React mocked Playwright tests: 2/8 player roster, inspect Bob at S-01 (Einstein), Alice's free move to Planck but button still targets N-01 (Gauss), remote active seat and private hand unchanged; inspector-only clicks issue **zero free-move/end-turn HTTP commands**, actor switch, leave clears actions, keyboard focus/Enter, EN translation, WebGL disabled and 390px mobile.
- Real React + .NET Playwright: use actual server-issued unique lot for Bob, select and verify canonical slot/street with no POST command or public revision change; after genuine free move to another street, inspect Alice's original lot without a second move.
- Three .NET xUnit Domain tests for 2/4/8 player first rounds: authoritative origin -> street mapping stays fixed while live pawn moves, intact through command turn progression and checkpoint restore.

All 3 GitHub Actions jobs must pass **on the exact final main SHA** before #131 closure. Related #5, #6, #13, #129, #130.
Issue: https://github.com/KeyserDSoze/Game.Edonism/issues/131
