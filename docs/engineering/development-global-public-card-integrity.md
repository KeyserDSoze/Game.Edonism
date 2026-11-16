# Fail-closed gross/resource scouting on forged uncontrolled board cards (#140)

## Demonstrated discrepancy

`verifiedPublicBoardCardCount` (#111) verifies the **complete**
`boardActivities` list against the one printed canonical 30-slot board:
unique real slot IDs, nonempty string card IDs and categories and valid
record shape. It returns `null` on any duplicate, foreign or malformed
board card, including a card in an otherwise uncontrolled printed lot.

Previously `publicGrossSalaryQuotes` (#105/#107) independently accepted
quote arithmetic and the subset of printed cards associated with public
`controlledActivities`, by calling `controlledLotMarkers`. Uncontrolled
cards were not included in that per-owner check. A forged extra/duplicate
card on a free/uncontrolled lot could therefore leave verified-looking
salary rows (#105), per-player economy (#138) and resources (#139) visible
while the board-card count badge correctly disappeared.

## Resolution

Reuse `verifiedPublicBoardCardCount(state)` *inside*
`publicGrossSalaryQuotes(state)` after basic array checks. Any `null`
makes the gross quote projection return `[]` — transitively hiding
both #138 and #139 read-only summaries because they depend on the same
complete verified gross quote set. Valid **uncontrolled** cards still
succeed: for a real synthetic full-deck .NET Development match, the
server places 30 printed cards on 30 canonical slots, of which 28 are
uncontrolled for 2 seats or 22 for 8 seats. Salary gross quotes remain
the original server data, not a new browser calculation.

Keep `hasValidDevelopmentPublicEnvelope` intentionally narrow:
malformed view-only card payloads must **not** revoke a bearer, clear a
private hand, prevent a valid turn or erase genuine public pawns.
**Exception for controlled-lot rendering:** the pre-existing #108
`controlledLotMarkers` safely rejects *all* lot markers when **any**
`boardActivities[*].slotId` is a non-string runtime value, even on
an uncontrolled lot. This is an intentional fail-closed rule, not a
regression. With well-shaped string slots, unrelated foreign or
duplicate unowned lots may still leave genuinely verified controlled
markers visible. The Domain `.NET 10 GrossSalaryRules`
remains sole authority for the gross pre-tax 2+upright controlled lot
quote and no salaries are credited in first-round Development.
No new endpoints, Production routes, client action rules or secrets.

## Regression coverage

- xUnit 2/4/8 with actual .NET `GameMatch` character/catalog setup,
  30 unique canonical publicly placed cards and genuine uncontrolled
  cards: no board, quote or wallet mutations after move/end turn.
- Actual Vite Playwright 2/4/8: legitimate extra unowned card preserves
  count, gross quote, economy and resources; duplicate, foreign, bad
  category/card/slot type at *only* unowned printed lot hide all
  financial summaries and board count. Existing controlled markers
  stay independently visible for a well-shaped (string) unowned slot;
  a non-string slot suppresses ALL markers per #108 fail-closed policy.
  Verify input immutability.
- Full React mocked Playwright 2/8 on true rendered city: legitimate
  extra unowned card preserves 3-card count and rows; bad card hides
  card count, quote, public economy and resources for all seats but
  retains legal turn, pawn inspection and real controlled markers.
  Narrow screen/no-WebGL and IT/EN included.
- Real browser + actual .NET API full-deck 2/8: 30 unique printed
  slots; 28/22 unowned and all true public summaries shown; move
  cannot mutate board slots/quotes or unexpectedly suppress display.

[GitHub #140](https://github.com/KeyserDSoze/Game.Edonism/issues/140).
Issue-first. Direct `main` commits. Close only after all three
GitHub Actions jobs are green on **exact final main HEAD**.

## #142 — Cloned physical activity identity on separate printed lots

The #111/#140 global public `verifiedPublicBoardCardCount` checked
canonical printed **slot** uniqueness but did not enforce the distinct
**physical CardId** guarantee of the trusted .NET activity deck. Two
`boardActivities` entries on different canonical slots could reuse
the exact same public `cardId` and incorrectly pass the board-count
and gross/economic/resource presentations. The .NET Domain draws 30
separate cards from 46 unique catalog IDs; none may be duplicated.

The #142 correction adds one exact, ordinal `cardId` Set check inside
the already-used full-board validator. No other runtime behavior is
weakened: legitimate different-case IDs remain distinct, and a truly
empty valid list still reports 0 (not `null`). Cloned IDs report
`null`, which hides the count and, via `publicGrossSalaryQuotes`,
hides every #138 and #139 seat-finance projection. A valid controlled
lot's owner/posture/marker and pawn/turn remain independently verifiable;
this never turns the client into a source of salary, combat, or game
authorization.

Regression gate: actual Vite TS 2/4/8 with two distinct valid unowned
cards, cloned unowned-vs-unowned, unowned-vs-controlled,
controlled-vs-controlled and malformed IDs, plus salary/economy/resources;
mocked React Playwright 2/8 mobile/no WebGL and language change;
xUnit actual .NET 2/4/8 seeded 30-card distinct IDs stable through real
move and end turn; live real .NET 2/8 30 distinct card IDs and visible
board/economic projections.

[GitHub #142](https://github.com/KeyserDSoze/Game.Edonism/issues/142);
close only after 3/3 CI jobs green on the exact current `main` SHA.

## #143 — Printed activity categories and full-deck quotas

The original Rulebook2 page 4 (already transcribed by the
`.NET ActivityPlacement.PrintedCategoryQuotas`) requires the selected
30-card Development board to contain precisely eight category counts:
5 public-financing, 5 private-financing, 4 black-market, 4 corruption,
4 culture, 2 sport, 3 transport and 3 bishopric. This is public,
printed setup metadata, not action/deck/hidden-hand content.

Previously `verifiedPublicBoardCardCount` checked only that category
was a nonempty string, allowing forged `outer-space` on an uncontrolled
lot or a complete 30-card payload with all IDs/slots unique but 29/30
cards assigned to impossible category quotas. The same global verifier
now rejects categories not in this exact printed list, and validates
the **eight quotas only when all 30 distinct canonical slots are
present**. Synthetic partial 0–29-card Development fixtures remain
permitted for existing read-only views and are *not* required to carry
full printed quotas. No new rules, client card selection or tax/credit
logic is introduced.

Any violation yields `null` for the board count, and by #140 also
hides all salary quotes, #138 economic scouting and #139 resources.
Independently valid controlled-lot markers, player street labels and
server turn commands remain unaffected.

Tests: xUnit .NET 10 Theory 2/4/8 real character setup + move/end;
actual Vite TS 2/4/8 valid partial/full/forged category and quota;
mocked React UI 2/8, mobile/no WebGL, IT/EN and real .NET live 2/8.
Track exact-head CI and issue closure at
[GitHub #143](https://github.com/KeyserDSoze/Game.Edonism/issues/143).
