# Public read-only resources in Development PvP city (#139)

## Verified source

`.NET 10 GameMatch.Snapshot().Players[*]` already exposes current
`Atoms`, `DiplomacyTokens`, `HenchmenTotal` and
`HenchmenAvailable` on the **public** Development match response.
In the first-round trusted setup, each player starts with 4 atoms,
2 diplomacy tokens and 16 total henchmen; one occupies an initial
controlled lot and 15 remain available. There is no salary payout,
spending, combat action or Production identity/authorization in
Development 0.0.2.

These public snapshot fields were previously dropped when
`DevelopmentMatchLab.publishPublicPositions` sent public positions
to `App`. The economic scouting panel (#138) already displays a
public **gross PRE-TAX quote**, but it is not the current atom amount.

## Renderer and fail-closed contract

Forward **only** these four server-reported public fields alongside
the existing player marker position. In `App`, show clearly separated
IT/EN `Atomi attuali / Current atoms`, `Gettoni diplomazia /
Diplomacy tokens` and `Scagnozzi disponibili / Available henchmen`
beside the same public city roster markers. All numeric values can
legitimately be zero; no inference of move or spending permission.

`verifiedPublicSeatResources(unknown)` reuses the **complete**
`verifiedPublicSeatEconomy` verifier (#138), which checks real
canonical streets, technical player identity, each controlled
lot/card/owner/posture and the full .NET gross quote set for 2–8
players. On any incomplete economic roster, **no** resources render.
The four fields must be nonnegative safe integers, and
`henchmenTotal - henchmenAvailable === verified controlledLots`.
No independent gross salary, credit or action rule is calculated.
Malformed or partially missing resource data hides ALL rows, not a
misleading subset. The public .NET match remains the sole authority.

No APIs, Web Storage, hands, faction data or bearer credentials are
added to the public projection; no changes to Domain gameplay.

## Tests

- .NET xUnit Theory 2/4/8 checks real initial counts, conservation
  of deployed controlled henchmen and unchanged resources/quotes
  after actual `TryFreeMove` and `TryEndTurn`.
- Actual Vite TypeScript Playwright 2/4/8: genuine 0 atoms/diplomacy,
  0-lot seats, unchanged input; missing/negative/fractional/unsafe
  resources, wrong reserve, duplicate ID, foreign road/owner,
  forged or incomplete quote fail closed.
- Mocked React Playwright 2/8, 390px/no WebGL + normal screen,
  IT/EN, movement, street selection, seat switch and leave; ensure
  observation never generates an extra gameplay command and a
  bad reserve suppresses all resource rows independently of other
  validated public summaries.
- Live React + actual .NET API 2 and 8 seats, initial real snapshot
  and accepted move, city attributes equal the server's public values.

Issue [#139](https://github.com/KeyserDSoze/Game.Edonism/issues/139).
0.0.2 Development only. Source of truth: the server, not the viewer.
Direct commit main and close only after exact final HEAD 3/3 CI green.
