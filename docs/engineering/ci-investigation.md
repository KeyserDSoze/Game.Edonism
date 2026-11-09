# GitHub Actions — verifica di job-start intermittente (#15)

## Rilevazioni del 9 novembre 2026

- [#42672788374](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42672788374): workflow **failure**, ma l'API Actions ha restituito un solo job completato, `.NET 10 / xUnit` **success** (63/63, build verde); il job React / Playwright non compare in `/jobs`.
- [#42673361729](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42673361729) e [#42673808396](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42673808396): tentativi con pipeline fullstack serializzata (per testare un percorso a job unico); workflow **failure**, con **0 job registrati**, senza log di step.
- **Non abbiamo prove della causa effettiva.** Nessun errore xUnit o Playwright è stato registrato nei workflow senza job. Una modifica del workflow non è una diagnosi di un errore di runner.
- È stata ripristinata la configurazione a due job usata con successo nella [CI precedente #42662734489](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42662734489).
- [#42674069929](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42674069929): workflow **success**, entrambi i job avviati e conclusi: **63/63 xUnit**, **5/5 Playwright**, build verdi.

## Decisione

Per questa release conservare il workflow originale a due job, perché è l'unico verificato positivamente dopo l'anomalia. Non dichiarare che la consolidazione l'abbia corretta: è stata ritirata. Se ricompare un workflow failure con zero job, riaprire #15 e controllare i dettagli nell'interfaccia GitHub Actions, la disponibilità runner, i limiti e i permessi Actions; i dati API raccolti non consentono di attribuire con certezza la causa.

Lo sviluppo diretto su `main` richiede sempre CI completa e verde per chiudere nuove issue; un job backend verde **non** basta se il workflow complessivo è rosso.
