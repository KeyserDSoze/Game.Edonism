# Active scouting filters and one-click reset (#95)

## Public-only purpose
This is a **Development-only** user experience for read-only PvP reconnaissance, downstream of #85/#88/#89/#90/#92/#93/#94 and tracked in [issue #95](https://github.com/KeyserDSoze/Game.Edonism/issues/95). Neither clearing filters nor reading the summary changes match rules or grants movement, attacking, purchase, faction, combat or private-card knowledge. Production authorization #13 and canonical printed rules #4 remain unresolved and are outside this feature.

## Invariants
Four independent predicates apply to already verified `opponentControlledLots.routes`, from the **single** actor/token/revision-bound atomic tactical overview (#88):

| Local display setting | Default | Safe meaning |
| --- | --- | --- |
| Verified public owner | All | Only owner IDs validated against the same public `otherPlayers.others` projection |
| Canonical board street | All | Only public `cityBoard.streets` IDs, matching the audited lot's `streetId` |
| Nearby lots | Disabled | Only routes with `streetSteps <= 1`, not a move/attack radius |
| Public henchman posture | All | Exact audited standing=0 / fallen=1, not hostility or combat authority |

If any predicate is active, show the **localized list of active criteria** and count (aria-live), and an accessible **Clear all filters** control. This operation assigns all four defaults together and calls `onTacticalFocus(null)` to prevent a stale map target. The active filter summary uses only already validated public IDs, canonical names and local labels. It must not introduce any GET, mutation, command, browser storage, credential exposure or history/audit event.

The canonical server order stays unchanged, so each #90 nearest-visible held lot remains the first matching route for a verified rival. The #92 public **player-position** focus remains available for every verified other seat even when no owned lots match. On match, seat or token switch, all four preferences are reset separately by the existing scoped effect; on forged/stale atomic tactical data the controls and summary fail closed.

## Verification
- **xUnit .NET 10:** unchanged 2/4/8 canonical public board/owned-lot route, posture, owner, distance, immutable checkpoint and audit tests; no new Domain implementation was needed.
- **Playwright mocked (2/8 seats):** composition of all four predicates, localized active criteria (IT/EN), keyboard Enter reset, mobile viewport, recovery of verified nearest lot, absent stale tactical focus, seat/token reset, no new tactical GET, forged scope never presents reset.
- **Playwright non-WebGL:** English mobile fallback can activate two filters then clear both via keyboard, preserving regular tactical player focus.
- **Playwright live vs .NET:** independent Alice and Bob bearer browsers, all four filters and one-click reset; restored public held lots match the full server-audited projection; no extra tactical read, change to revision, public match snapshot or audit.

The issue may be closed **only** when all 3 GitHub Actions jobs are successful on the exact final `main` SHA.
