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

## #91 — Budget mirato per replay offline con due pagine

I workflow #43448948141, #43449098525 e #43449265718 falliscono sempre lo stesso test `offline public replay validates completed two-seat round but rejects premature settlement` con `Test timeout of 30000ms exceeded`, seguito da `browserContext.close` su un contesto già terminato; gli altri 133–137 test UI, gli xUnit e i Playwright full-stack sono verdi in questi run. Un'altra revisione esegue invece questo test correttamente, quindi il comportamento è compatibile con un **budget insufficiente sotto carico**, non con una modifica dimostrata al validatore.

Soluzione: `test.setTimeout(75_000)` **solo dentro quel test**. Il test avvia due pagine complete con scena/canvas e confronta un export di round completo con il suo replay offline, poi manipola `round-settlement-pending` e verifica il rifiuto del file contraffatto e l'assenza di sessione. I test restano identici e obbligatori, con gli stessi retry CI (`1`), timeout di default (`30s`) e asserzioni. La pulizia del secondo contesto rimane nel `finally`, senza nasconderne gli errori. Un eventuale ulteriore fallimento richiede analisi del trace, **non** l'esclusione dei test.

La chiusura #91 e della #90 richiede 3 job completati con successo sullo **stesso SHA finale** di `main`, non solo run precedenti. [Issue #91](https://github.com/KeyserDSoze/Game.Edonism/issues/91).

## #103 — Parallelismo isolato dei browser mock Development

Prima del cambiamento, [CI #43508994557](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43508994557) ha eseguito **177** test React/Playwright in **12,7 minuti** (diagnostica Playwright: `e2e/development-match.spec.ts` 12,6m) nonostante 2 worker. Nel successivo [run docs #43511332572](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43511332572), con gli stessi 177 test, il tempo è stato **8,8 minuti**: il confronto fra runner diversi è variabile, non un benchmark stabile.

Il file mock `src/frontend/e2e/development-match.spec.ts` usa solo costanti immutabili e funzioni helper a livello di modulo; token, stato revisionato, fixture 2–8 giocatori, `page.route`, risposte HTTP, audit, timers e liste di richieste sono creati **dentro** ogni `mockMatchApi(page, options)`, su un `page` Playwright dedicato per test. Non si fanno affidamenti sull'ordine dei test o su uno stato condiviso fra worker. `test.describe.configure({ mode: "parallel" })` è **limitato a questo file** per consentire ai due worker Playwright già attivi in CI di distribuire i casi mock indipendenti; non si modifica il numero globale dei worker né l'applicazione.

Il vero `e2e-live/real-match.spec.ts` rimane nella suite separata, con `workers: 1`, API .NET reale, due sessioni browser, controlli autenticazione/riservatezza e tutte le asserzioni esistenti. Niente skip, retry addizionali, timeout estesi, nuove API o modifica dei dati privati. Il risultato va misurato sui log CI dei job, senza attribuire ogni variazione temporale al parallelismo; tre job completati e verdi sullo **SHA esatto finale** di `main` sono obbligatori per chiudere [#103](https://github.com/KeyserDSoze/Game.Edonism/issues/103).

### Esito esecuzione funzionale #103

[CI #43691464132](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43691464132) sul commit `f23f8f4`: **3/3 job success**, **665 xUnit + 177 React/Playwright mock + 40 Playwright contro .NET reale = 882/882**. La suite mock è durata **7,2 minuti** contro le due misure precedenti di **12,7** e **8,8 minuti** (−43% e −18%, rispettivamente; campioni su runner diversi, non benchmark controllato). La suite full-stack, invariata e seriale, è durata **7,9 minuti**. Nessun test saltato, nessuna modifica alle asserzioni o alla gestione delle credenziali. L'issue va chiusa solo dopo la nuova CI 3/3 anche sul commit finale che registra questi numeri.

## #106 — Audit offline con due pagine senza WebGL sotto carico

Nel [run #43695691370](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43695691370), commit documentale `e37c960` di #104, **665 xUnit** e **40 Playwright con API .NET reale** sono verdi, ma il test mock `offline public replay validates completed two-seat round but rejects premature settlement` ha superato **due volte** il limite di **75 secondi**; **177/178** test mock sono passati. Il `context.close()` ha fallito **come conseguenza della chiusura browser per timeout**, non come prova di divergenza del replay. Artefatto diagnostico reale [#14155245592](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43695691370/artifacts/14155245592): entrambi i trace raggiungono import del file pubblico e validazione dell'evento di saldo anticipato contraffatto, poi scade il budget durante le ultime verifiche della timeline.

La prova è un **audit DOM di file JSON**, non una prova dell'animazione o geometria 3D: due città Three.js complete nello stesso test, con il worker Playwright concorrente #103, consumano risorse che possono ritardare gli assert. #106 limita a **questo test** il ricorso al fallback WebGL già esistente: `page.addInitScript` sulla pagina autenticata + `context.addInitScript` sul browser offline **disabilitano solo webgl/webgl2/experimental-webgl**, lasciando il canvas 2D intatto; il fallback viene esplicitamente verificato su entrambe le pagine. Si preservano export autenticato, import offline, navigazione #0/#1/#2, cronologia/attori, rifiuto di `round-settlement-pending` anticipato, timeline cancellata, nessuna sessione privata. Il test mantiene lo stesso limite **75s**, retry, due worker mock complessivi e real-.NET one-worker, senza skip né cambiamenti di gioco. Se i trace rivelassero un ulteriore stallo, investigare, non alzare indiscriminatamente i timeout.

Issue [#106](https://github.com/KeyserDSoze/Game.Edonism/issues/106). Richiedere il **3/3 esatto su ultimo main HEAD** prima di sbloccare #104 e chiudere #106.
