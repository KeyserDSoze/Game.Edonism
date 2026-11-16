# #153 — Confronto pubblico delle impronte territoriali PvP

## Scopo

La matrice delle 7 strade (#152) espone il possesso pubblico dei 30 lotti di Edonism. La nuova vista di ricognizione sintetizza per **ogni giocatore pubblico**, compresi quelli con zero attività, le attività **attualmente controllate** (`controlledLots`), gli scagnozzi **in piedi / atterrati** e il numero di **strade diverse** con almeno un lotto controllato (`occupiedStreets`).

Questa **non è una classifica di vittoria**, un criterio ufficiale di controllo stradale, un diritto di attacco/acquisto, una nuova regola o un calcolo di salario. #4/#7/#8 definiscono ancora le condizioni originali da approvare e implementare.

## Proiezione verificata e ordinamento

1. `verifiedPublicTerritoryFootprints(snapshot)` legge **soltanto** la matrice intera `verifiedPublicStreetControlMatrix(snapshot)` (#152), a sua volta ricavata da 30 carte/slot pubblici, tutte le categorie e quote stampate, 2–8 identità canoniche, proprietari e posture validi e univoci. Un singolo errore nello snapshot fa sparire **l'intero confronto**.
2. Ogni proprietario presente nelle **sette** righe viene contato una volta nel riepilogo, inclusi **zero** lotti. Per ogni proprietario: somma lotti, in piedi, atterrati e numero delle strade dove possiede almeno un lotto.
3. Incrocia le somme con il totale dei lotti controllati/posture della matrice, con `liberi + controllati = 30`. L'ordine dei proprietari deve coincidere in tutte le righe e corrispondere a quello del roster valido.
4. Il criterio **puramente visuale** per confrontare i giocatori è il numero di lotti controllati decrescente; se uguale, ordine deterministico per ID tecnico ordinale (non locale-dependent). A parità di **numero di lotti**, stessa posizione **competition style**: `1, 1, 3`. Le posture e le strade occupate sono dettagli e **non** spezzano i pareggi; non esistono punti-vittoria derivati.
5. Il riquadro React è un `<details>` **collassato** di default, con etichette IT/EN, compatibile con tastiera/mobile/no WebGL. Non espone nomi o ID di carte private, token, fazioni, attacchi, punteggi segreti o comandi HTTP.

## Matrice test

- **xUnit Domain reale .NET 10 2/4/8:** fixture full-deck con un lotto e uno scagnozzo in piedi per ogni giocatore, confrontata con `Snapshot()` e le rotte avversarie bearer-protected del Domain, prima/dopo movimento gratuito/fine turno. Controlli su 30 carte, audit e mani private.
- **Playwright Vite 2/4/8:** import del modulo vero TS; rank 1/1 su pari merito, posture diverse senza cambiamenti di posizione, classifica 1/2 su lotti aggiunti, lotti zero, ordine ID ordinale, sette strade, all-owned 30/30, rotazione/settlement, casi falsificati e input immutato.
- **React Playwright mock 2/8 IT/EN/mobile/no-WebGL:** due posti con un lotto → pareggio in prima posizione; altri sei posti sintetici zero-lotti in posizione 3; label di non-vittoria, collassato di default, postura di Bob atterrato senza perdere il pareggio; ancora nessun POST mutante.
- **Playwright fullstack live .NET 2/8:** confronto in un'unica lettura DOM dei posti, rank, lotti/posture/strade con `created.state.controlledActivities` ricevute dal vero backend. Il helper #152 verifica le rotte /uncontrolled-routes e /opponent-controlled-routes sullo stesso snapshot. Ispezione mantiene la revisione invariata.

Issue [#153](https://github.com/KeyserDSoze/Game.Edonism/issues/153), dipende da #152 e parent #6. In Development, non login Production (#13). Adozione e chiusura **solo** dopo il gate 3/3 GitHub Actions sul commit esatto di `main`.
