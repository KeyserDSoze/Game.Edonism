# Validation of public gross salary view (#105)

This is a **display-only** guard for the Development city sidebar, not a new
gameplay calculator, payout, wallet mutation, or authorization boundary.
Authoritative .NET `GrossSalaryRules.Quote` (#14; printed rulebook p. 5)
remains the source: **2 base atoms + 1 per standing controlled activity**
in the first-round gross projection. Tax, net payment, mayor and powers are
unresolved decisions in #4/#6/#7/#8, never inferred by this UI.

`publicGrossSalaryQuotes(state)` executes against the **same public
authenticated snapshot** used to draw match markers and control lots. Before
showing any gross quote, the pure projection requires:
- An array of public players with unique nonempty IDs; public controlled lots
  must all be renderable by the existing checked `controlledLotMarkers`
  projection (known board slot, matching placed card, unique ownership,
  publicly known owner and valid standing/fallen posture).
- Every gross quote's owner must appear exactly once, base must equal the
  printed constant 2, all three counts must be nonnegative **safe integers**,
  gross must exactly equal base + standing count, and standing count must
  equal the owner's validated **public** standing controlled lots.
- A single forged/duplicate/unknown/malformed field or unrenderable public
  control rejects the **entire** displayed gross-quote list instead of showing
  a plausible subset. No fabricated fallback amounts, no API call, no change
  to private hands or game commands. The already-verified match state and
  controlled markers remain independently visible; the UI can still perform
  permitted server-authenticated actions.

Regression gate: Playwright direct browser import of the real TS function,
deterministic **2/4/8** seats with standing/fallen owners and 14 forged values
per count plus malformed/array/null inputs; a full mocked browser confirms a
forged total hides salary rows without hiding existing owned lots or granting
optimistic permission; xUnit and real Playwright with two independent .NET
bearer sessions must stay green. Close #105 only on **3/3 completed/success on
the exact latest main HEAD**.

[Issue #105](https://github.com/KeyserDSoze/Game.Edonism/issues/105)

## Functional validation result

[CI #43700125397](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43700125397) on implementation SHA `05074908588d8b7d0d2d3c3eabfb30278de9837e` completed **all 3/3 jobs successfully**: **665/665 xUnit**, **186/186 mocked Playwright** (6.4 minutes; seven #105 pure cases + one #105 mocked UI), and **40/40 live Playwright against real .NET** (8.3 minutes), **891/891** tests total. No skipped tests, no change to Production API, private card/token storage or server wallet rules. Issue closure still requires another 3/3 run on the final documentation-only HEAD.
