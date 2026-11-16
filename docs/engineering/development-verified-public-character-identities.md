# #146 — Identità di personaggio e attività iniziale verificate nel roster PvP

## Contesto (Development 0.0.2)

La fotografia `MatchSnapshot` .NET include **pubblicamente** le carte `assignedCharacters`: `playerId`, `characterId`, `startingActivityCardId`, `printedInitialHearts`. Il motore conserva separatamente mani, mazzo e credenziali. Il roster in città mostra già i cuori con controllo completo di provenienza (#141, #145); mancavano gli identificativi di personaggio e attività visibili a tutti.

Gli identificativi attuali sono **tecnici/sintetici** e non nomi o illustrazioni canoniche delle carte originali (#19). Nessun dato su fazioni, poteri, carte azione o credenziali è introdotto.

## Contratto di visualizzazione

`verifiedPublicCharacterRoster(snapshot)` si appoggia al medesimo controllo `verifiedPublicCharacterHearts(snapshot)`, quindi:

- richiede da due a otto giocatori, identità e posizioni canoniche, personaggi univoci e cuori stampati 1–5 corrispondenti;
- se la plancia è completa (30 attività), richiede che ogni carta iniziale pubblica sia **l'unica** carta posta nel lotto stampato del suo giocatore;
- torna una `ReadonlyMap` **vuota per l'intero roster** se la provenienza è dubbia (nessun risultato parziale);
- espone soltanto `characterId`, `startingActivityCardId` e `printedInitialHearts` già pubblici: non diffonde `privateHand`, `remainingDrawPile`, token di sessione, carta elezione nascosta o segreti di altri giocatori;
- preserva la compatibilità con fixture incomplete e legacy (#141/#145) e non modifica quote, marker, risorse, azioni o API.

L'interfaccia rende i due ID pubblici in righe di roster separate, accessibili, responsive e localizzate IT/EN, con `data-testid` e attributi di provenienza usati solo dai test. Nessuna azione di gioco è associata agli ID.

## Test automatizzati

- xUnit Theory full-deck 2/4/8 con setup Domain autentico, univocità degli ID, carta iniziale e lotto, prova di non esposizione della mano privata nello snapshot JSON e stabilità dopo free move/end turn.
- Playwright sul modulo TypeScript reale Vite 2/4/8: proiezioni valide, legacy e parziali, swap/ID duplicati, ID riservati, mismatch cuori, lotto di origine contraffatto, input immutabile, assenza di proprietà private.
- React Playwright mock 2/8, IT/EN, mobile e WebGL disabilitato: ID reali coerenti e invisibili se gli input sono falsificati, mentre economia, posizioni e comandi rimangono invariati.
- Playwright contro API ASP.NET Core reali 2/8: il roster visibile coincide con i valori della stessa risposta pubblica .NET.

Tracking: [#146](https://github.com/KeyserDSoze/Game.Edonism/issues/146). Chiusura soltanto dopo i tre job CI verdi sull'HEAD finale di `main`.
