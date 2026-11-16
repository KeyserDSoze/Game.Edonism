# #156 — Timeout mirato del test PvP React a otto giocatori

## Origine
Il run GitHub Actions [#43903367742](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43903367742), commit `d0c45ac66186b47ee8c718861351256be67cbdcd`, ha superato 779/779 xUnit .NET e 42/42 Playwright live .NET, ma 521/522 Playwright React: **l'unico test in timeout** è `#149: 8 seats free public activity atlas, forged quota=false` in `e2e/development-match.spec.ts`. L'asserzione finale sul filtro categoria ha esaurito il timeout **test-level 30s**, sia nella prima esecuzione sia al retry. Nessun mismatch di dati o regressione del backend è dimostrato dal log.

Il caso è deliberatamente più oneroso di un normale test: rende una plancia di 30 lotti con WebGL, sette strade con conteggi, almeno 56 indicatori proprietario (8 giocatori × 7 strade), due pannelli collassabili, filtri, lotto di ispezione, ranking territoriale e controllo di assenza dei comandi di mutazione.

## Correzione mirata
- Aggiungere `test.setTimeout(90_000)` **solo** quando `count===8 && !invalidQuota` nel test esistente; lasciare invariato il timeout globale Playwright React di **30 secondi**, il numero di test e l'aspettativa per singola asserzione.
- Omettere una seconda `selectOption("")` sulla categoria quando il pulsante di esplorazione strada ha già cancellato quel filtro; verificare comunque esplicitamente `categoryFilter` vuoto e 28 risultati pubblici.
- Non saltare, ridurre né rendere mock separati i controlli: 30 carte pubbliche, 28 libere, owner 2/8, tutte 7 strade, posture, pareggi, ordinamento, IT/EN, mobile/no WebGL, ispezione e nessuna mutazione di gameplay rimangono coperti.
- Il timeout del job Playwright live resta il **solo live 90s** della #154 (già 42/42 sul precedente run); il fix #156 non modifica backend né diritti PvP.

Issue [#156](https://github.com/KeyserDSoze/Game.Edonism/issues/156), dipende da #149, #150–#153. Chiudere con le issue correlate soltanto dopo **3/3 GitHub Actions verdi sullo SHA esatto di main**.
