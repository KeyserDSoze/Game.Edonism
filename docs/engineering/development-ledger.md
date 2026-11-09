# Edonism — development ledger

GitHub Issues are the detailed source of truth. Work is committed directly to `main` as requested; CI remains mandatory.

| Issue | Version | Work | Status | Verification |
|---|---|---|---|---|
| [#1](https://github.com/KeyserDSoze/Game.Edonism/issues/1) | 0.0.1 | Foundation: React/Three.js, .NET 10, CI | Done | PR #2 merged, CI green |
| [#4](https://github.com/KeyserDSoze/Game.Edonism/issues/4) | 0.0.2 | Printed rulebook baseline and unresolved design | In progress | Baseline merged #10; signoff and R-10 board inferred edges pending |
| [#5](https://github.com/KeyserDSoze/Game.Edonism/issues/5) | 0.0.2 | 30-slot street graph, 3D viewer | Done | PR #11 merged, 28 xUnit + 5 Playwright |
| [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6) | 0.0.2 | Server-authoritative setup and round lifecycle | In progress | Child #12 first slice; card draw/salary/elections still pending |
| [#12](https://github.com/KeyserDSoze/Game.Edonism/issues/12) | 0.0.2 | Trusted match movement, turn intent, revision & dev API | In progress | Direct main commit; CI pending |
| [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13) | TBD | PvP identity, persistence and durable authorization | Planned | Requires #6 and external identity plan |
| [#7](https://github.com/KeyserDSoze/Game.Edonism/issues/7) | TBD | Cards and powers resolver | Planned | Requires canonical card catalog |
| [#8](https://github.com/KeyserDSoze/Game.Edonism/issues/8) | TBD | PvP factions, mayor, corruption, victory | Planned | Requires #6 |
| [#9](https://github.com/KeyserDSoze/Game.Edonism/issues/9) | TBD | Original art and card assets | Planned | Require individual assets and publication approval |

Next: validate #12 CI, then implement the remaining #6 setup/round settlement when designer-approved rules and card catalog permit it. Never expose development fixture routes in production.
