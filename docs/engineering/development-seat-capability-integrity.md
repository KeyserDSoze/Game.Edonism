# Unicità delle capability per i posti PvP Development (#60)

## Vulnerabilità

I giocatori della fixture Development hanno un bearer opaco casuale da 32 byte, passato solo in `X-Edonism-Dev-Token`. In memoria viene mantenuto **soltanto il digest SHA-256** del token per ciascun posto. Il file opzionale AES-GCM memorizza i digest, non i token chiari. `Entry.ResolveActor` calcola il digest del bearer presentato e restituisce il **primo** playerId il cui digest combacia. Prima di #60, `TryGetEntry` durante il restore convalidava i nomi dei posti e la forma di ogni digest, ma **non ne verificava l'unicità**.

Se un checkpoint semanticamente contraffatto ma correttamente cifrato assegna a due player ID lo stesso digest, chi usa quel bearer può ottenere il primo posto della mappa anziché quello inteso. Il rischio riguarda l'identità autoritativa e la **mano privata**. AES-GCM protegge da modifiche prive della chiave, ma non certifica la coerenza di tutti i campi di un contenuto cifrato legittimamente.

## Contratto di creazione e recupero

- `DevelopmentMatchStore.Register` assegna 2–8 token di 32 byte generati da `RandomNumberGenerator`, converte il bearer in HEX e conserva solo il digest SHA-256. In caso di collisione con qualunque digest già assegnato alla stessa partita, tenta una nuova generazione; azzera il buffer di bytes di origine prima della pubblicazione.
- `DevelopmentMatchStore.TryGetEntry` valida **prima** di creare/popolare la `Entry`: esattamente una chiave per ciascun playerId canonico, digest non nullo di 64 caratteri HEX, 32 byte una volta decodificati, **digest distinti nella rappresentazione normalizzata**. Il confronto delle forme esadecimali raw non basta: `aBc` e `AbC` possono essere lo stesso valore. La deduplicazione usa `Convert.ToHexString(Convert.FromHexString(hex))`, cioè i bytes effettivamente autenticati.
- `TryRotateSeatToken` rimane actor-scoped e persiste il nuovo digest prima di revocare quello vecchio, con verifica non-collisione di tutti i digest esistenti. Nessun endpoint aggiunto, nessuna cache HTTP, mano o token in una proiezione pubblica; cambio revisione e turni non sono influenzati.

Un checkpoint AES-GCM autenticato ma con mapping ambiguo/non valido **fallisce closed**: `TryRead`, `TryReadHand`, `TryBootstrapSeat`, `TryReadHistory`, `HasSeatAccess` non pubblicano nulla. Una partita già caricata in una diversa istanza rimane indipendente dal file manomesso.

## Regression test

- xUnit con file AES-GCM ri-cifrato da un fixture autorizzato: digest Alice/Bob identico, alias lowercase/uppercase, digest null, lunghezza 63 o 64 HEX non validi. Si testa la negazione per entrambi i token originari e per ciascuna proiezione pubblica/privata.
- xUnit parametrizzato 2–8 posti: credenziali distinte, rotazione di `player-0`, revoca del token originario e nuovo store che accetta ancora gli altri bearer senza confonderli.
- Playwright live con API .NET reale e due browser indipendenti: Bob ruota il proprio bearer, la mano di Bob non cambia, Alice conserva la sua e nessuna carta di Alice compare nel secondo browser; l'eventuale query string `?playerId=alice` non autorizza Bob a leggere Alice.
- Tutte le suite precedenti xUnit, Playwright UI mocked e Playwright live rimangono nel gate della CI di `main`.

La protezione è un invariante delle capability **Development** e non implementa autenticazione, database multiistanza o identità Production, rimasti in [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13). [Issue #60](https://github.com/KeyserDSoze/Game.Edonism/issues/60) registra la CI conclusiva e la checklist, [ledger](development-ledger.md) segue lo sviluppo. Non modifica il regolamento PvP né risolve le scelte aperte #4/#6.

## CI dell'implementazione

[CI #43131999851](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43131999851) ha verificato il commit funzionale [`42e8b98`](https://github.com/KeyserDSoze/Game.Edonism/commit/42e8b98b4fa4cd8b4160cd260a7bc4ae923d7946) con **413/413 xUnit (0 skip), 97/97 Playwright UI e 30/30 Playwright live API .NET, totale 540/540**, 3/3 job verdi sullo SHA. Il gate successivo verifica anche il commit conclusivo della documentazione, con report e closure nella [issue #60](https://github.com/KeyserDSoze/Game.Edonism/issues/60).
