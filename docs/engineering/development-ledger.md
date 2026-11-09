# Edonism — development ledger

GitHub Issues are the detailed source of truth. Work is committed directly to `main` as requested; CI remains mandatory.

| Issue | Version | Work | Status | Verification |
|---|---|---|---|---|
| [#1](https://github.com/KeyserDSoze/Game.Edonism/issues/1) | 0.0.1 | Foundation: React/Three.js, .NET 10, CI | Done | PR #2 merged, CI green |
| [#4](https://github.com/KeyserDSoze/Game.Edonism/issues/4) | 0.0.2 | Printed rulebook baseline and unresolved design | In progress | Baseline merged #10; signoff and R-10 board inferred edges pending |
| [#5](https://github.com/KeyserDSoze/Game.Edonism/issues/5) | 0.0.2 | 30-slot street graph, 3D viewer | Done | PR #11 merged, 28 xUnit + 5 Playwright |
| [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6) | 0.0.2 | Server-authoritative setup and round lifecycle | In progress | Child #12 first slice; card draw/salary/elections still pending |
| [#12](https://github.com/KeyserDSoze/Game.Edonism/issues/12) | 0.0.2 | Trusted match movement, turn intent, revision & dev API | Done (direct main) | [CI #42662175729](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42662175729): 53/53 xUnit, 5/5 Playwright; build green |
| [#14](https://github.com/KeyserDSoze/Game.Edonism/issues/14) | 0.0.2 | Initial activity control, standing henchman and gross salary quotes | In progress | Domain/API xUnit + Playwright CI pending; tax and wallet credit intentionally deferred |
| [#15](https://github.com/KeyserDSoze/Game.Edonism/issues/15) | 0.0.2 | Repair CI completion semantics, unified full-stack gate | In progress | Backend xUnit passed, prior workflow failed without frontend job; verification pending |
| [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13) | TBD | PvP identity, persistence and durable authorization | Planned | Requires #6 and external identity plan |
| [#7](https://github.com/KeyserDSoze/Game.Edonism/issues/7) | TBD | Cards and powers resolver | Planned | Requires canonical card catalog |
| [#8](https://github.com/KeyserDSoze/Game.Edonism/issues/8) | TBD | PvP factions, mayor, corruption, victory | Planned | Requires #6 |
| [#9](https://github.com/KeyserDSoze/Game.Edonism/issues/9) | TBD | Original art and card assets | Planned | Require individual assets and publication approval |

Next: verify #14 CI on main, then progress #6 through character/starting-activity catalog and server-owned setup; resolve #4/R-10 inferred edges before public matches. #13 owns production identity and persistence. Development fixture routes stay unavailable in Production.
