# Edonism — development ledger

GitHub Issues are the detailed source of truth. Work is committed directly to `main` as requested; CI remains mandatory.

| Issue | Version | Work | Status | Verification |
|---|---|---|---|---|
| [#1](https://github.com/KeyserDSoze/Game.Edonism/issues/1) | 0.0.1 | Foundation: React/Three.js, .NET 10, CI | Done | PR #2 merged, CI green |
| [#4](https://github.com/KeyserDSoze/Game.Edonism/issues/4) | 0.0.2 | Printed rulebook baseline and unresolved design | In progress | Baseline merged #10; signoff and R-10 board inferred edges pending |
| [#5](https://github.com/KeyserDSoze/Game.Edonism/issues/5) | 0.0.2 | 30-slot street graph, 3D viewer | Done | PR #11 merged, 28 xUnit + 5 Playwright |
| [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6) | 0.0.2 | Server-authoritative setup, cards/turn primitives and incomplete round lifecycle | In progress | #12/#14/#16/#17/#18/#20 implemented; settlement, played-card effects, election rules unresolved |
| [#12](https://github.com/KeyserDSoze/Game.Edonism/issues/12) | 0.0.2 | Trusted match movement, turn intent, revision & dev API | Done (direct main) | [CI #42662175729](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42662175729): 53/53 xUnit, 5/5 Playwright; build green |
| [#14](https://github.com/KeyserDSoze/Game.Edonism/issues/14) | 0.0.2 | Initial activity control, standing henchman and gross salary quotes | Done (direct main) | [CI #42674069929](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42674069929): 63/63 xUnit, 5/5 Playwright, builds green; payout/tax deferred to #6 |
| [#15](https://github.com/KeyserDSoze/Game.Edonism/issues/15) | 0.0.2 | Investigate CI job-start anomalies; restore verified two-job gate | Resolved | Attempted consolidation produced zero jobs; reverted to prior workflow; [CI #42674069929](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42674069929) green. Root cause unknown |
| [#16](https://github.com/KeyserDSo/Game.Edonism/issues/16) | 0.0.2 | Seeded 46-to-30 card setup, mandatory starting cards and match streets | Done (direct main) | [CI #42676164483](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42676164483): 86 xUnit, 5 Playwright, build green |
| [#17](https://github.com/KeyserDSoze/Game.Edonism/issues/17) | 0.0.2 | Draw 23 public characters, printed hearts and starting activity | Done (direct main) | [CI #42678161809](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42678161809): 109 xUnit, 5 Playwright, build green |
| [#18](https://github.com/KeyserDSoze/Game.Edonism/issues/18) | 0.0.2 | 58 actions + Election Day, four initial cards and actor-private hand | Done (direct main) | [CI #42682381016](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42682381016): 131/131 xUnit and 5/5 Playwright; zero .NET warnings/errors |
| [#19](https://github.com/KeyserDSoze/Game.Edonism/issues/19) | TBD | Acquire individual official card files and metadata with provenance | Blocked on source files and rights | Rulebook screenshots are not full card assets |
| [#20](https://github.com/KeyserDSoze/Game.Edonism/issues/20) | 0.0.2 | Dev-only React match lab: server-authoritative moves, turns and private hands | Done (direct main) | [CI #42685047656](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42685047656): 131 xUnit, 10 Playwright, builds green |
| [#21](https://github.com/KeyserDSoze/Game.Edonism/issues/21) | 0.0.2 | CI true React/Vite ↔ .NET Development API: movements, turns, actor privacy | Done (direct main) | [CI #42693030133](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42693030133): 131 xUnit + 10 UI Playwright + 3 live Playwright, all 3 jobs green |
| [#22](https://github.com/KeyserDSoze/Game.Edonism/issues/22) | 0.0.2 | Player Pucciottini positioned on canonical roads via public .NET match snapshot | In progress | 131 xUnit + UI & real API Playwright verification pending |
| [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13) | TBD | PvP identity, persistence and durable authorization | Planned | Requires #6 and external identity plan |
| [#7](https://github.com/KeyserDSoze/Game.Edonism/issues/7) | TBD | Cards and powers resolver | Planned | Requires canonical card catalog |
| [#8](https://github.com/KeyserDSoze/Game.Edonism/issues/8) | TBD | PvP factions, mayor, corruption, victory | Planned | Requires #6 |
| [#9](https://github.com/KeyserDSoze/Game.Edonism/issues/9) | TBD | Original art and card assets | Planned | Require individual assets and publication approval |

Next: verify #22 CI for live 3D markers; acquire official card art (#19/#9), validate R-03/R-07/R-09/R-10 (#4), extend match gameplay (#6) and real PvP sessions (#13). Dev API stays Development-only.
