# #177 — Fail-fast Playwright test discovery in the existing 3-job CI

## Why

The default frontend build `npm run build` uses `tsc -b && vite build`, which does **not** include files in `src/frontend/e2e/*.spec.ts` or `e2e-live/*.spec.ts`. The real CI for #175 and #176 detected test **syntax errors** only when `npm run test:e2e` finally started collecting tests. #175 had a malformed TypeScript type assertion in a forged JSON fixture; #176 had a split-line TypeScript cast in a fixture. In each case the backend xUnit build was green, and Chrome/real API startup and browser-test runner time were spent before discovery failed. These were test-parser failures, not incorrect .NET game rules.

## New fast, nonempty discovery gates

The repository retains the **same three GitHub Actions jobs**, with their original full xUnit, actual React/Playwright and Live React + real .NET/Playwright suites, retry/diagnostics behavior and branch-concurrency policy. The new steps run **before** Chromium launch and before the live API starts.

1. Frontend job: after `npm run build`, run `npm run test:playwright-discovery:unit` (Node built-in tests) then `npm run test:e2e:list` to load the actual Playwright default config and all imported mocked E2E spec modules, without launching Vite/Chromium or running tests.
2. Full-stack job: after `npm install` and before starting the real .NET API or Chromium, run `npm run test:e2e:live:list`. This loads **only** `playwright.live.config.ts` and `e2e-live` specs, never substitutes mocked tests.
3. The shared `scripts/playwright-discovery.mjs` runs `playwright test --list` (with the live config when selected) through the **installed** Playwright CLI and parses the native `Total: N tests in M files` output. Fails if CLI exits nonzero, a parsing/config error occurs, the output is absent/invalid, or either count is zero. On success it prints only the positive test/file count. The CLI listing does not execute the `webServer` entry, launch a browser, run test bodies or touch the .NET API.

## Local commands

From `src/frontend` after `npm install`:

```sh
npm run test:playwright-discovery:unit
npm run test:e2e:list
npm run test:e2e:live:list
# Full suites (still authoritative, not replaced):
npm run test:e2e
npm run test:e2e:live
```

`playwright-discovery.test.mjs` uses Node `node:test` with a fake child-process adapter to cover valid mocked/live command arguments, positive singular/plural/comma/ANSI counts, missing/zero/truncated/overflow reports, malformed fixture CLI failures and absent runner errors. The actual **non-mocked** discovery scripts run the installed Playwright CLI during CI and fail if no real specs are available.

## Guarantees and limitations

This is only **early static test parsing and inventory**, **not** permission to skip actual Chromium or xUnit tests, and not an extra green job. Browser runtime assertions still execute in both original suites and the real Development API is still required for live tests. A green preflight does not prove game correctness; full three-job completed/success remains required on the **exact latest main SHA** before closing the issue.

Track [#177](https://github.com/KeyserDSoze/Game.Edonism/issues/177); related #175/#176. No change to Edonism's first-round rules, API, gameplay or Production authentication.
