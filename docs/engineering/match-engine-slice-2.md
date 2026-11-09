# Match engine — controllo attività iniziali e salario lordo (#14)

**Regolamento stampato (fonte):** `rulebook2.zip`, **p. 4** (il giocatore riceve una attività iniziale, piazza sopra uno scagnozzo, ha 16 scagnozzi, 4 atoms e 2 token diplomazia), **p. 5** (2 atoms di salario base + 1 per attività controllata con scagnozzo in piedi; lo scagnozzo atterrato non contribuisce).

## Decisione di implementazione

- Il modello `MatchControlledActivitySnapshot` descrive un **lotto controllato con uno scagnozzo** e postura `Standing/Fallen`. Non rappresenta né l'illustrazione né il potere di una carta.
- Il setup **trusted development fixture** riconosce automaticamente una attività iniziale controllata in ogni `StartingSlotId`, con scagnozzo `Standing`. Ogni giocatore parte con 16 scagnozzi totali, **15 disponibili** e uno già sul tabellone. Doppie posizioni non sono permesse.
- `GrossSalaryRules.Quote` è una funzione pura che verifica validità di slot/owner/postura, unicità del lotto e coerenza fra numero di scagnozzi schierati e riserva. Calcola `BaseAtoms + StandingActivityAtoms = GrossAtoms` indipendentemente da quale schermata o API richieda la previsione.
- Lo `Snapshot` dell'aggregato include `ControlledActivities` e `GrossSalaryQuotes` come collezioni in sola lettura. L'API già esistente `GET /api/dev/matches/{id}` li restituisce solo in Development, dopo verifica del token di giocatore. Il client non può inviare aggiornamenti di scagnozzi/ownership.
- **Non è un pagamento.** Lo stato `AwaitingRoundSettlement` e i wallet dei giocatori restano invariati. Salario netto, tasse del sindaco, `Innovate`, `Pizzo`, regole su corruzione, altre attività e gli avanzamenti di round fanno parte delle issue #4/#6/#7/#8.
- La prima configurazione di personaggi e carte dalla stampa è ancora da costruire. `StartingSlotId` è una fixture tecnica dell'ambiente di sviluppo, non una modalità di piazzamento controllata dall'utente in una partita pubblica.

## Copertura test

xUnit per fixture, determinismo del preventivo, posta `Fallen`, isolamento fra proprietari, >16 scagnozzi, player/slot duplicati e sconosciuti, immutabilità dei preventivi, rifiuto di un endpoint mutativo delle attività. CI esegue anche Playwright sulla mappa React. Non viene avviata nessuna partita pubblica.

## Riferimenti

- [#14](https://github.com/KeyserDSoze/Game.Edonism/issues/14) — questa tranche.
- [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6) — setup/round/azioni completi.
- [#4](https://github.com/KeyserDSoze/Game.Edonism/issues/4) — validazione delle interpretazioni e del salario R-08.
- [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13) — storage/identità PvP.

## Verifica finale

[Workflow green su `main` #42674069929](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42674069929): **63/63 xUnit**, incluso `GrossSalaryRulesTests` e contratto HTTP Development, **5/5 Playwright**, build .NET con 0 warning/0 errori. La CI ha avuto alcuni problemi di avvio dei job durante l'integrazione, descritti in [ci-investigation](ci-investigation.md); l'ultima esecuzione sul workflow ripristinato è stata completa e verde.
