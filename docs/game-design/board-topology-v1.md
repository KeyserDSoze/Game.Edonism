# Plancia originale — grafo strade e 30 spazi (v1)

**Decisione approvata (#5, 2026-11-09):** mantenere le regole e la **topologia delle strade originali**, ma rappresentare la città in 3D. Gli esagoni introdotti nella foundation 0.0.1 **non** sono posizioni di movimento.

## Provenienza
- `rulebook2.zip` — **p. 4**: 30 carte attività posizionate negli spazi grigi; **p. 7**: movimento consentito solo tra strade adiacenti, esempi espliciti; **p. 8**: denominazioni/legenda delle strade.
- `plancia di gioco.png` — 1504 × 998 pixel, 30 grandi rettangoli grigi più City Hall nella piazza centrale. Interpretazione di posizioni, intersezioni e orientamento.
- JSON source of truth: `src/shared/board/edonism-board.v1.json`.

Le coordinate `x/y` del JSON sono **centri stimati delle caselle nell'immagine sorgente**, non spostamenti consentiti né coordinate GPS. I codici `N-01`, `S-01` ecc. sono **identificatori tecnici introdotti per la digitalizzazione**, non codici presenti nelle carte stampate.

## 30 spazi attività

| Strada | ID | Conteggio | Posizione |
| --- | --- | ---: | --- |
| Gauss Avenue | N-01 … N-08 | 8 | fascia nord |
| Einstein Avenue | S-01 … S-08 | 8 | fascia sud |
| Newton Avenue | W-01 … W-03 | 3 | bordo ovest |
| Planck Avenue | E-01 … E-03 | 3 | bordo est |
| Boson Street | B-01 … B-04 | 4 | due file interne a ovest della piazza |
| Meson Street | M-01 … M-04 | 4 | due file interne a est della piazza |
| Main Square | — | 0 | ospita il Municipio, **non** è slot attività |
| **Totale** | | **30** | |

## Grafo di movimento tra strade

Strade: `gauss`, `einstein`, `newton`, `planck`, `boson`, `meson`, `main-square`.

Connessioni bidirezionali. Una mossa da strada a strada è consentita **solo attraverso un arco**, indipendentemente dalla posizione sullo schermo e dal numero di edifici presenti.

| Connessione | Provenienza |
| --- | --- |
| Planck ↔ Gauss | **Esplicita**: esempio p. 7 |
| Planck ↔ Einstein | **Esplicita**: esempio p. 7 |
| Planck ↔ Meson | **Esplicita**: esempio p. 7 |
| Einstein ↔ Newton | **Esplicita**: esempio p. 7 |
| Einstein ↔ Main Square | **Esplicita**: esempio p. 7 |
| Newton ↔ Gauss | **Inferita**: incrocio nord-ovest sulla plancia |
| Newton ↔ Boson | **Inferita**: incrocio ovest/centro sulla plancia |
| Gauss ↔ Main Square | **Inferita**: asse centrale dalla via nord verso la piazza |
| Main Square ↔ Boson | **Inferita**: collegamento occidentale della piazza |
| Main Square ↔ Meson | **Inferita**: collegamento orientale della piazza |

**Verifica ancora necessaria:** l'utente ha confermato *la scelta di preservare la topologia originale*, non le singole cinque connessioni ricostruite visivamente. Le cinque inferenze sono sufficienti per una **anteprima e una proposta tecnica**, ma non vanno considerate un rulebook emendato. Il backend #6 non deve attivare match reali su questo grafo prima di un'ulteriore conferma degli archi.

## Contratti

- Il backend serve la mappa pubblica via `GET /api/v1/board` e convalida struttura e grafo con `BoardDefinition.Validate`.
- Le 30 activity card effettive sono **pescate** e posizionate in modo casuale durante la partita secondo il regolamento; il JSON **non** fissa alcuna carta su uno slot.
- La funzionalità `ActivityPlacement.Assign` è un blocco infrastrutturale *puro* per mescolare un insieme **già scelto** di carte con un seed riproducibile. Non include regole del mazzo né una partita attiva.
- Il frontend rende strade e placeholder: la selezione non è una mossa del giocatore. Main Square non è acquistabile come attività; la logica del Municipio appartiene a #8.

## Test d'accettazione
- xUnit: sette strade, 30 ID distinti, slot su via valida, simmetria e raggiungibilità del grafo, esempi p. 7, rifiuto strutture malformate e riproducibilità del seed.
- Playwright: vista city, selezione strada/slot, vicinanza strada secondo grafo, Main Square senza slot, temi i18n, viewport mobile e fallback non-WebGL.
