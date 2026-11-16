# #148 — Tutti i rivali pubblici più vicini al giocatore di turno

## Obiettivo PvP (Edonism 0.0.2 Development)

Il roster città mostra già per ogni rivale i passaggi fra strade dal giocatore di turno (#147). La nuova vista **Avversari più vicini al giocatore di turno** / **Nearest rivals to the turn owner** sintetizza la *minima* distanza pubblica e mostra **tutti** i rivali a quella distanza, senza perdere gli ex aequo. Questa è solo informazione topologica, non costo di movimento, portata d'attacco, potere, fazione o permesso a un comando.

## Provenienza e integrità

Il selettore puro `verifiedNearestActiveTurnRivals(snapshot)`:

1. riusa **direttamente** `verifiedActiveTurnRivalProximity` (#147), che richiede 2–8 ID giocatore tecnici validi e univoci, posizioni sulle strade canoniche, un attore attivo canonico realmente presente, e percorsi deterministici da `shortestStreetPath` sul grafo condiviso con .NET;
2. restituisce `[]` se la validazione completa fallisce o il round attende settlement con `activePlayerId=null`; non sceglie mai tra un sottoinsieme di un roster falsificato;
3. trova il minimo tra gli **N−1** rivali verificati e conserva *tutti* quelli con `streetSteps === minimo`, compreso il caso di più avversari sulla stessa strada a **0 passaggi**;
4. ordina gli ID a parità di distanza con confronto ordinale case-sensitive, mai locale o fuzzy;
5. copia solo `playerId`, origine/destinazione pubbliche, passi e path; non legge private hands, carte azione, credenziali, wallet o fazioni.

Il riquadro React è collocato in fondo al roster, in un `section` accessibile con pulsanti di semplice ispezione. Il click chiama **solo** `chooseStreet(targetStreet)`: seleziona una strada già stampata e non effettua POST, non cambia il giocatore autenticato, non muove pedine e non crea nuove API. La lista dei posti nel `<ul>` del roster originale resta intatta e mantiene esattamente N righe.

## Matrice test

- xUnit Domain 2/4/8, `OtherPlayerRoutesTests`: tutti gli ex aequo al minimo dello snapshot .NET (origin/after move/after end turn), stessa distanza del grafo canonico, ordine per ID, mani private e atomi invariati; fixture 4 posti con due rivali sulla stessa strada a 0 passi.
- Playwright nel vero modulo Vite/TypeScript 2/4/8: tutti gli ex aequo, 0 passi, minimum con uno/due/molti pari, origine dopo mossa e turno, snapshot contraffatti, 1/9 giocatori, input immutato, nessun segreto in output.
- React Playwright mock 2/8, IT/EN/mobile/no WebGL: ID ordinati, distanze, click di sola ispezione, aggiornamento dopo turni, niente lista durante settlement, assenza nuove richieste mutanti.
- Playwright live React + API .NET 2/8: confronto esatto del numero, dell'identità e della distanza di tutti i pulsanti con il minimo del vero endpoint bearer `other-player-routes` (#51); click che lascia invariati la revisione e l'attore di turno.

### Confini di autorità

Non introduce vittorie, combattimento, acquisizione lotti o regole di movimento (#4, #6, #8). Nessun campo Production o segreto (#13). Issue [#148](https://github.com/KeyserDSoze/Game.Edonism/issues/148). Chiudere soltanto dopo tutti i tre job CI verdi sull'HEAD finale di `main`.
