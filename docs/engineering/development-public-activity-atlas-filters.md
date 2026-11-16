# #150 — Filtri pubblici dell’atlante delle attività non controllate

## Scopo

Nel primo round Development PvP una plancia stampata completa espone 30 carte attività pubbliche, 22–28 delle quali non sono controllate. Con #149 la città mostra tutte queste carte in un atlante collassabile; #150 introduce due **preferenze puramente locali** e combinabili: una delle sette strade stampate e una delle otto categorie stampate.

Il filtro **non** rappresenta un'azione acquistabile, movimento legale, distanza d'attacco, diritto a controllare un lotto, né una ricerca tra carte private.

## Fonte della verità e fail-closed

1. `selectVerifiedPublicUncontrolledActivities(snapshot, filters)` chiama **prima** `verifiedPublicUncontrolledBoardActivities(snapshot)` (#149) sull'**intero snapshot**, prima di filtrare. Nessuna voce può arrivare direttamente dal browser senza verificare 30 slot, carte fisiche univoche, quote di categoria, 2–8 giocatori e **tutti** i controlli di lotti.
2. L'elenco delle categorie non è un secondo catalogo divergente: riusa `printedActivityCategoryQuotas` dall'unica proiezione pubblica che valida il mazzo, le quote e i nomi tecnici #143; le strade sono in `cityBoard.streets` dallo stesso JSON condiviso con .NET.
3. La preferenza sconosciuta (tipo errato, ID fuori board, categoria non stampata) è normalizzata a **tutte**. I filtri non devono nascondere in modo arbitrario un rivale o una carta non verificata. Un board incompleto o contraffatto produce **all=[], visible=[], totalCount=0** indipendentemente dalle preferenze.
4. Le viste `all` e `visible` sono in ordine dei **30 slot stampati** e non mutano l'input né attribuiscono permessi di gioco.
5. La UI mostra **visibili / totale** (non confondere il numero filtrato con il numero reale di carte libere) e un messaggio accessibile se la combinazione valida non restituisce risultati. Il totale dell'atlante rimane lo stesso.
6. I due `<select>` sono visibili solo con l'atlante verificato. Sono etichettati e tradotti in italiano/inglese, così come gli otto nomi delle categorie. La UI mantiene i filtri su una revisione aggiornata della **stessa** partita e li azzera se cambia match o se il giocatore esce dal laboratorio. Nessun localStorage, nessun token, nessun nuovo endpoint, nessun POST; l'ispezione rimane `chooseSlot` di sola visualizzazione.

## Verifica richiesta

- xUnit .NET 10, partite full-deck 2/4/8 reali: per tutte le coppie 7×8 strada/categoria il sottoinsieme di `VerifiedUncontrolledRoutesForActor` coincide con le carte pubbliche non controllate dello snapshot; checkpoint/audit invariati.
- Playwright che importa il vero helper Vite 2/4/8: tutte, singola strada, singola categoria, filtri combinati, vuoto, preferenze invalide (fallback a tutte), board falsificato, ordine e input immutati, assenza dati segreti.
- Playwright mock React 2/8 IT/EN/mobile/no WebGL: 7+8 opzioni canoniche, conteggi sullo stesso totale, zero-results, ispezione del lotto, nessuna mutazione.
- Playwright live React e vere API .NET 2/8: i sottoinsiemi e conteggi visibili corrispondono esattamente a `GET /api/dev/matches/{id}/uncontrolled-routes` bearer-authenticated, con stato vuoto e ritorno a tutte.

### Confini

Dipende da [#149](https://github.com/KeyserDSoze/Game.Edonism/issues/149); parent #6. Non assume regole di poteri, acquisto o Pvp ancora aperte (#4/#7/#8), non è Production (#13). Issue [#150](https://github.com/KeyserDSoze/Game.Edonism/issues/150). Chiudere solo con tutte tre suite CI verdi sull'HEAD di `main`.
