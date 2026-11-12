# Sicurezza del mazzo privato al restore Development — #58

## Perché esiste

Nel primo round autoritativo la distribuzione iniziale usa la routine Domain `InitialActionDeckComposer.Deal`: combina i 58 ID sintetici di azioni e 1 ID Election Day, li ordina con `StringComparer.Ordinal` e applica uno shuffle Fisher–Yates con PRNG xorshift32 e seed fissato dalla fixture Development. Ogni player in `TurnOrder` riceve 4 carte nell'ordine del mazzo; il resto è **privato del server**. I checkpoint cifrati (#26) riportano il seed, `AlgorithmVersion`, mani, pila rimanente e snapshot pubblico. Il vecchio `RestoreFromCheckpoint` rifiutava duplicati, carenze e algoritmi sconosciuti ma non gli scambi/riordini che mantenevano cardinalità e unicità.

## Contratto ricalcolato

`InitialActionDeckComposer.MatchesRecordedShuffle(recorded, playerIds)` è una verifica pura `bool`, separata da autorizzazione HTTP e output pubblico. Reimpiega la **medesima** funzione `ShuffleSortedIds` già usata dal compositore nel nuovo setup: non si mantengono due shuffle simili. Valida:

1. Versione `initial-actions-v1-xorshift32` e 2–8 ID attore univoci/validi nella stessa sequenza dell'audit pubblico.
2. Esattamente 59 ID carta privati non vuoti, tutti univoci, con 4 ID per ciascuna mano e 59−4×giocatori carte restanti.
3. Confronto **posizionale** di ogni mano e della pila residua con la permutazione ricalcolata a partire dagli stessi 59 ID, ordinati e rimescolati con il seed registrato. `Election Day` è una carta fisica fra le 59, **non** richiede trattamento speciale per calcolare lo shuffle.

`GameMatch.RestoreFromCheckpoint` invoca la verifica **prima di creare un `GameMatch` recuperato**. Su discordanza lancia `InvalidDataException` con messaggio generico, mai ID o carte di un giocatore. Un `DevelopmentMatchStore` nuovo che carica un checkpoint AES-GCM logicamente incoerente non restituisce snapshot, mani o history. Il processo esistente può conservare la sessione in memoria, che non viene modificata dal file corrotto.

## Compatibilità e limiti

Il test non cambia l'algoritmo di `Deal`, i vettori deterministici, i count (58+1, quattro carte), l'ordine di turno, la politica R-09 sull'Election Day, le carte nascoste o il formato del checkpoint v1. Restano restaurabili i setup di soli posti, quelli con soli personaggi senza mazzo di azioni, i checkpoint cifrati legacy compatibili e le partite ferme in `AwaitingRoundSettlement`. Il controllo non prova la provenienza **dei nomi** delle 59 carte né la legittimità del seed contro un attaccante che può riscrivere e ricalcolare tutto il checkpoint: per autenticità di file resta AES-GCM, per gli asset originali #19, per la sicurezza multiutente Production #13. Nessun effetto della carta, salario, round successivo o evento è introdotto.

## Verifica

xUnit: shuffle 2–8 posti e seed vari, inversione dei due ID in una mano, scambio carte fra posti, scambio mano/pila, riordino pila, scambio mani intere, seed/versione alterata, duplicato/carta mancante, no-secret-in-errors, persistenza delle mani dopo le mosse e fino al settlement, compatibilità fixture senza deal, restart da file AES-GCM con manoscritto logicamente alterato ma cifratura valida, legacy v1 cifrato. La suite Playwright UI mocked continua a controllare l'assenza di carte private nel pubblico. Playwright live comunica con l'API .NET reale, controlla le mani separate per bearer e che **nessuna carta privata cambi dopo i due turni o appaia nello snapshot pubblico**.

[Issue #58](https://github.com/KeyserDSo/Game.Edonism/issues/58) tiene la checklist e il report CI: chiudere soltanto dopo i 3 job success su **identico HEAD finale di `main`**.

## Verifica della prima integrazione

La [CI #43123352250](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43123352250) sul commit [`c6a4535`](https://github.com/KeyserDSoze/Game.Edonism/commit/c6a4535a9e3cf368e719d78fac1567f4b1479d60) ha completato **3/3 job success**, con **378/378 xUnit (0 skip), 97/97 Playwright UI e 30/30 Playwright contro l'API .NET reale**: 505/505 test. Copre il ripristino del mazzo deterministico, tutte le mutazioni, i file cifrati, le fixture legacy e il mantenimento delle mani segrete dopo i turni. La CI successiva sulla documentazione finale e la chiusura sono riportate nella [issue #58](https://github.com/KeyserDSoze/Game.Edonism/issues/58).
