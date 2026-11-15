# Canonical turn-option destination ingress (#124)

## Problem
The Development HTTP public envelope already verifies the canonical board version and all public player street IDs (#122/#123). Actor-scoped /turn-options previously accepted any unique nonblank freeMoveStreetIds string, allowing an otherwise plausible HTTP 200 to offer a button for an invented street. The backend would still reject the command, but the browser could misrepresent an available PvP option.

## Scope
The existing pure hasValidDevelopmentTurnOptions now imports the same versioned shared board JSON and checks every destination against its seven street IDs. It rejects a forged destination as part of the entire options response, rather than keeping the other buttons. Existing match/actor/revision/turn parity, no-self, no-duplicate and consumed-free-move guards remain. Re-fetch with a legitimate actor-scoped response recovers the UI. No new endpoint, rules, movement algorithm or client authority is introduced.

This deliberately checks membership, NOT adjacency. A well-typed canonical but nonadjacent destination remains transport-shaped; the .NET Domain is the sole authority for legal movement and commands. Hands, factions and other actor-private data never enter this validation and must not leak.

## Tests
- Six actual Vite browser-loaded TypeScript Playwright cases cover 2/4/8 public seats, every canonical street (excluding the actor's own street), 14 forged destination values as singleton and mixed response, self and duplicated destinations, and input immutability.
- A new mocked full React browser scenario injects an HTTP 200 with planck plus an invented destination, checks all-or-nothing suppression with hand and public match continuity, then recovers after a legitimate actor-scoped refresh and ends the turn without a fabricated move.
- Three xUnit Theory cases run 2/4/8 authoritative Domain matches through every free move and end turn, pending settlement and checkpoint restore; every option is from the canonical board, with neighbors checked only server-side.
- Keep all prior mocked, xUnit and full-stack live .NET Playwright tests; issue closes only when all three CI jobs are green on the exact final main commit.

Issue: https://github.com/KeyserDSoze/Game.Edonism/issues/124
