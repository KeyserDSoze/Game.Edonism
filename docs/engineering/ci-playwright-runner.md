# Stabilità Playwright in GitHub Actions — #47

## Diagnosi

Il 11 novembre 2026 i nuovi test di #46 hanno superato **282 xUnit** nel run [#43032795376](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43032795376). Entrambi i job Playwright non sono arrivati ai test: `npx playwright install --with-deps chromium` falliva durante `apt` con `Temporary failure resolving` dei mirror Ubuntu (exit 100) sul runner Ubuntu 26.04 (`resolute`).

Il primo fix, host `ubuntu-24.04` nei due job, ha mantenuto lo **stesso problema** nel [run #43034375775](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43034375775), stavolta sui mirror `noble` / `azure.archive.ubuntu.com`. Le build TS/.NET e xUnit rimangono verdi; il problema è l'installazione pacchetti del browser, non un fallimento di test applicativi.

## Fix di infrastruttura

Entrambi i job browser su runner `ubuntu-24.04` eseguono i test **dentro** `mcr.microsoft.com/playwright:v1.55.0-noble`, immagine ufficiale con Chromium e dipendenze OS preinstallate. `@playwright/test` è fissato esattamente a `1.55.0` affinché i percorsi browser nel container corrispondano alla versione del client. Non c'era un lockfile npm prima di questa modifica; `npm install` resta in CI.

Lo step che eseguiva `npx playwright install --with-deps chromium` (e quindi `apt` ad ogni run) è sostituito da uno smoke **reale di Chromium** (`chromium.launch()` + `close()`). Uno smoke fallito blocca il job prima dei test; non ci sono opzioni `continue-on-error`, skip o fallback silenziosi. I due job preservano **tutte** le suite Playwright (mock UI e full-stack reale) e il terzo job conserva xUnit/.NET 10.

Il container è una dipendenza di infrastruttura: se MCR/registry/pull dovesse fallire, la CI resterà rossa. Non confondere un test non eseguito con uno passato. Per chiudere [#47](https://github.com/KeyserDSoze/Game.Edonism/issues/47) e [#46](https://github.com/KeyserDSoze/Game.Edonism/issues/46), richiedere i tre job `completed/success` sul medesimo HEAD finale di `main`.

## Verifica attesa

- .NET 10 build e 282+ xUnit (inclusi quota creator 64/60s, body max 128 KiB, no-store e gating Production)
- React TypeScript + bundling + Playwright browser reale con UI IT/EN e mobile
- Playwright con due browser contro la vera API .NET in Development, inclusi nuovi test #46 e regressioni di privacy/turni
