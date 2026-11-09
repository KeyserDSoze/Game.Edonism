# Edonism — development ledger

GitHub Issues are the detailed source of truth. Keep this index short.

| Issue | Version | Work | Status | Verification |
|---|---|---|---|---|
| [#1](https://github.com/KeyserDSoze/Game.Edonism/issues/1) | 0.0.1 | Foundation: monorepo, 3D hex preview, shadcn shell, .NET 10, CI and tests | Done (PR #2) | PR #2 merged; PR/main CI green (8/8 xUnit, 4/4 Playwright) |
| [#4](https://github.com/KeyserDSoze/Game.Edonism/issues/4) | 0.0.2 | Printed rulebook baseline, provenance and discrepancy index | In progress | Docs PR #10 merged; game-designer verification pending |
| [#5](https://github.com/KeyserDSoze/Game.Edonism/issues/5) | 0.0.2 | 30-slot original street graph, seeded placement & 3D viewer | In progress | xUnit/Playwright CI pending; inferred edges need review before live matches |
| [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6) | TBD | Server-authoritative match state and turn lifecycle | Planned | xUnit / integration |
| [#7](https://github.com/KeyserDSoze/Game.Edonism/issues/7) | TBD | Data-driven cards and powers resolver | Planned | xUnit reaction/state matrices |
| [#8](https://github.com/KeyserDSoze/Game.Edonism/issues/8) | TBD | Factions, mayor, corruption, secret communication and PvP win | Planned | two-client integration + E2E |
| [#9](https://github.com/KeyserDSoze/Game.Edonism/issues/9) | TBD | Card assets and city art pipeline | Planned | asset validation + Playwright |

Next: verify #5 CI and topology review; then define #6 authoritative setup/actions with no WebGL-based decisions.
