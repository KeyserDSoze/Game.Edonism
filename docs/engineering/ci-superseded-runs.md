# GitHub Actions: superseded workflow cancellation (#96)

## Motivation and scope
Edonism development goes directly to `main` and requires all three GitHub Actions jobs on the exact final SHA before any feature/bug issue is closed. Back-to-back commits previously launched overlapping 659+ xUnit, 148 Playwright mocked and 40 full-stack Playwright runs, spending CI resources on changes already replaced by newer commits. GitHub Actions supports workflow-level [concurrency groups](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency).

## Configuration
In `.github/workflows/ci.yml`, at workflow top level:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Grouping by `github.workflow` prevents a CI run from canceling a **different** workflow in the same repository. Grouping by `github.ref` separates `refs/heads/main` from `refs/pull/<id>/merge`, and separates PR refs from one another. A newer push to the same ref supersedes both pending and running older `CI` runs in that group. A canceled run is expected and must not be treated as either test success or a regression against the final HEAD.

## What must remain unchanged
The change must neither remove nor skip the three established jobs:
1. `.NET 10 / xUnit`, building the full `Edonism.slnx` and running xUnit;
2. `React / Playwright`, building the frontend with TypeScript and executing mocked browser tests;
3. `Live React + .NET / Playwright`, building/running the **real** Development API and using real bearer browser sessions.

The existing `contents: read` minimum permission, browser container image, no-store/public-private boundaries, failure diagnostics, and per-job timeouts remain as-is. No game logic, Production identity, network permission, test assertion, or coverage is modified.

## Validation and release criterion
After pushing the workflow edit followed by this documentation commit:
- Confirm GitHub marks the intermediate same-ref workflow as `cancelled` when superseded.
- Fetch the latest Git `main` SHA and the run for that exact commit, not the previously passing run.
- Confirm all **three** jobs are `completed/success`; inspect the xUnit, mocked and live test counts from their logs.
- If any final-HEAD job fails, fix and re-run; a canceled or obsolete earlier run cannot authorize closure.
- Document exact latest SHA and CI URL in issue #96 and close only after the 3/3 gate.

The source of truth for these semantics is [GitHub's concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency). Printed rules issue #4 and Production authentication issue #13 remain unresolved and are deliberately unaffected.
