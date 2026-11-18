# #162 — Read-only hypothetical 0/1/2 atom salary tax scenarios

## Printed source and intentionally limited scope
The printed Italian rulebook, `rulebook2.zip` **pp. 5, 9–10**, establishes gross salary **2 atoms + 1 per controlled standing henchman** and allows the mayor to set a salary tax of **0, 1 or 2 atoms**. This first-round Development implementation cannot yet elect a mayor, collect taxes, pay salary, draw cards, choose/execute actions or start a new round. In particular, it **MUST NOT** silently default the real current tax to zero. `hypotheticalTaxScenarios` are **three alternative calculations only**, not the actual policy nor a withdrawal/deposit.

## Domain and transport contract
- `MatchSalaryTaxScenarios.Quote(IReadOnlyList<MatchGrossSalaryQuote>)` is a **pure, immutable** function. It rejects null/duplicate/invalid technical owner IDs, 0/1/9 seats, malformed base/standing/gross values, gross mismatch and >30 standing controlled lots. Zero-owned players are legal and receive gross 2, hence hypothetical net 2/1/0 for tax 0/1/2.
- It always returns ordered `hypotheticalTaxAtomsPerPlayer = 0, 1, 2` in three nested **read-only arrays**, with each original owner in server seat order, their authoritative `grossAtoms`, `hypotheticalTaxAtoms`, `hypotheticalNetAtoms`, and `potentialWithheldAtoms = tax × playerCount`. These are sums that *could* be withheld, NOT municipal balance.
- `GameMatch.PendingSettlementPreview` calls the helper from its **already audit-verified first-round snapshot** and exposes the scenarios as one additional property on the **same** bearer-locked `GET /api/dev/matches/{matchId}/settlement-preview`. Existing pre-last-turn 409, unauthorized/revoked 404, no-store and Production 404 remain. There is no new endpoint or mutation; snapshot wallet stays 4.
- The React Development panel validates actor scope, matchId, round, revision, next order, every canonical gross quote and the **exact three** scenarios including each owner's net and potential-withheld arithmetic. Invalid or incomplete responses cannot populate gross or hypothetical cards. Text in IT/EN explicitly warns no tax was chosen/applied, no wages paid and no money moved; there is no action button for selecting an option.

## Testing and closure discipline
- xUnit pure: 2/4/8, zero-controlled owners, posture-aware canonical gross, exact 0/1/2 totals, negative/overflow/fake/duplicate input, immutable nested arrays.
- xUnit Domain 2/4/8 full deck, genuine end-turn/movement, pending-only read, audited revision, same private deck and identical encrypted-checkpoint restoration, no wallet credits; existing legacy preview remains valid.
- xUnit authenticated HTTP 2/4/8 before/after first-round transition, no-store and bearer rotation/revocation, quoted potential withholding, no changes to public state; Production endpoint absent.
- Playwright mocked React IT/EN/mobile with malformed stale/owner/tax/gross/missing scenarios fail-closed; separate Chromium tests dynamically importing the real Vite compiled validator for 2/4/8.
- Playwright live React + **real .NET API**: 2-seat two-browser and full 8-seat flows, compare every rate/owner/net to the server JSON and unaffected actual wallets with no extra gameplay POST.
- #162 tracks this work under parent #6. Close **only after all 3 GitHub Actions gates pass on the exact final main HEAD SHA**, recording run link + test totals on #162 and #6. Source/asset and Production blockers #4/#7/#8/#9/#13/#19 remain open.

The #161 ledger row is reconciled with verified CI [#43964488649](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43964488649): 857 .NET + 527 React + 42 live = 1,426/1,426 PASS on c99113f.

## Follow-up #165 — independent owner-ID trust boundary

The standalone React tax-preview validator now also applies the same 2–8-seat technical player ID policy as .NET (`MatchParticipantId.IsValid`) to **every gross owner**. This ensures a forged yet internally consistent 0/1/2 preview cannot claim `system` or malformed Unicode as an owner when the helper is called independently of the public snapshot gate. See [the focused test plan](development-tax-preview-seat-identity.md). No tax/payment behavior changed.
