# Stabilità Playwright in GitHub Actions — #47

## Evidenza

La CI precedente di Edonism è stata verificata anche con browser reali su .NET 10. Il giorno 11 novembre 2026, dopo il nuovo codice #46 (limiti ai creator delle fixture), la CI sul commit `d821806` [run #43032795376](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43032795376) ha eseguito con successo **282 xUnit**, ma entrambi i job Playwright hanno fallito **durante l'installazione** di Chromium, senza eseguire alcun test. I log mostrano repository apt `resolute` (Ubuntu 26.04), `Temporary failure resolving 'security.ubuntu.com'`, e `Installation process exited with code 100`.

## Intervento

In `.github/workflows/ci.yml`, i job `React / Playwright` e `Live React + .NET / Playwright` usano ora `runs-on: ubuntu-24.04`. Il job `.NET 10 / xUnit` resta su `ubuntu-latest`, già verificato. Questa modifica fissa l'ambiente supportato dai package browser, mantenendo `npx playwright install --with-deps chromium` e **tutti** i test Playwright mocked e full-stack. Non sono saltati o disabilitati step di sicurezza o browser.

Questa scelta riduce la variabilità del runner, ma **non garantisce** l'assenza di outage DNS o apt: una nuova eventuale indisponibilità esterna deve essere riportata come problema infrastrutturale e il gate va rieseguito, senza dichiarare successo. Solo un HEAD finale di `main` con tre job `completed/success` permette di chiudere #47 e #46. I test di #46 verificano payload >128 KiB, quota 64/60s, UI IT/EN, e partita a due browser sulla vera API .NET.

Issue [#47](https://github.com/KeyserDSoze/Game.Edonism/issues/47) (stabilità CI); [#46](https://github.com/KeyserDSoze/Game.Edonism/issues/46) (limiti API Development).
