# Navigazione accessibile a tappe del focus tattico — #53

## Confini

È un completamento UI di #52 e #6, non un percorso di movimento. Gli ID sono già nella proiezione pubblica firmata dal contesto di sessione Development e rivalidata da `verifiedTacticalFocus`; le regole sul grafo e sul movimento rimangono nell'API .NET. Nessun nuovo endpoint, comando, permesso di comprare/attaccare o inferenza di fazione. #4/R-10 richiede ancora approvazione del grafo e #13 autenticazione Production.

## Semantica

Il riepilogo HTML mostra un elenco ordinato di tappe, dalla strada iniziale alla strada di arrivo (inclusi entrambi, anche quando coincidono). Ogni tappa ha un pulsante con nome pubblico e numero progressivo, etichetta localizzata IT/EN e `aria-current="step"` sul punto esplorato. L'evento click verifica **nuovamente** il focus contro snapshot+revisione prima di selezionare la strada; non ricostruisce itinerari dalla geometria 3D. Le tappe intermedie visitano il primo slot pubblico di quella strada solo come dettaglio esplorativo. L'ultima tappa di una attività seleziona proprio il lotto target; un target giocatore seleziona la strada pubblica e il relativo primo slot.

Selezionare una tappa non cancella il percorso evidenziato, non modifica revisione/turno e non invia richieste API. Un click altrove nella plancia oppure cambio seat, token, revisione, leave o revoca cancella i controlli con il focus. Il riepilogo e i pulsanti funzionano anche quando Canvas WebGL è indisponibile.

## Verifiche

Playwright mocked: origine-intermedia-destinazione, target attività esatto, attributo ARIA, nessuna revisione modificata, cancellazione dopo ispezione manuale; Playwright EN su viewport mobile senza WebGL con attivazione **Enter**; itinerario zero archi, più regression per manomissione e scope (#52). Conservare tutte le suite preesistenti xUnit Domain e Playwright full-stack con due browser/API .NET. La chiusura della [issue #53](https://github.com/KeyserDSoze/Game.Edonism/issues/53) richiede i tre job verdi sul medesimo HEAD di main.
