# #152 — Controllo territoriale PvP pubblico per strada

## Scopo: confronto fra avversari, senza inventare regole

La città di Edonism ha **7 strade e 30 slot attività**. Per un match Development completo da 2 a 8 giocatori il server .NET già comunica `boardActivities` e `controlledActivities`: ogni slot con carta fisica e ogni lotto attualmente controllato con proprietario pubblico e scagnozzo in piedi/atterrato.

Il nuovo riquadro accessibile **Territorio pubblico: lotti liberi e controllati per strada** / **Public territory: free and controlled lots by street** mostra i dati che servono a leggere il territorio PvP senza supporre portate d'attacco, acquisti, costi, transizioni o effetti delle carte non ancora formalizzati (#4, #7, #8).

## Integrità e fonte

La proiezione pura `verifiedPublicStreetControlMatrix(snapshot)` esegue i gate nell'ordine:

1. Richiede il roster canonico di 2–8 giocatori senza posizioni tecniche non valide, `boardActivities` e `controlledActivities` come liste, tutte le **30 carte pubbliche** con ID fisici, slot e quote di categoria canoniche (`verifiedPublicBoardCardCount` #140–#143).
2. Usa `verifiedPublicUncontrolledBoardActivities` (#149) **sull'intero snapshot**, non su un subset filtrato del client, e `controlledLotMarkers` per tutti i lotti controllati con proprietari pubblici e posture valide. Non si possono nascondere occupazioni invalide classificandole falsamente come libere.
3. Riconcilia ogni singolo ID fra lista completa dei 30 slot stampati, controllati e liberi **una volta e solo una volta**; le due liste sono disgiunte. Ammette anche il caso futuro di una plancia completamente controllata e **0** liberi, purché tutti i 30 controlli siano realmente validi.
4. Restituisce sempre sette righe nell'ordine `cityBoard.streets`. Ogni riga contiene `totalSlots`, `freeLots`, `controlledLots`, `standing`, `fallen` e la ripartizione per **tutti** gli ID del roster pubblico, nell'ordine dei posti del server, compresi gli owner con conteggio **zero**.
5. Verifica per strada `liberi + controllati = slot stampati`, `in piedi + atterrati = controllati`, somma owner `= controllati`, e globale `somma slot = 30`. Se un controllo fallisce **tutta la matrice scompare** (nessun dato parziale presentato come verificato).

Questa è informazione **pubblica, non autenticazione, non authorization, non previsione dei diritti a un'azione**. Non legge mano, pila, voto, fazione, token, wallet, poteri, futuro salario o permission del giocatore.

## UI

Il riquadro è un `<details>` separato e **collassato di default**, compatibile con React mobile e renderer no WebGL; ogni riga è una strada stampata, con un bottone di sola **ispezione della strada** (`chooseStreet`), contatori liberi/controllati/postura e righe brevi per proprietario incluso chi non ha attività. Test ID consentono confronto con API .NET. La selezione non esegue POST mutanti, non cambia revision/turn owner, non modifica lotti o altre visualizzazioni #147–#151. Stringhe IT/EN e aria-label specificano esplicitamente la natura read-only.

## Matrice test

- **xUnit Domain .NET 10 2/4/8**, vero `GameMatch.CreateFromTrustedFullDeckSetup`: snapshot, ogni strada/owner, 30 lotti, match fra `VerifiedUncontrolledRoutesForActor` e `VerifiedOpponentControlledLotsForActor` su *tutti* i posti autenticati, posture e quote invarianti dopo free move ed end turn, stessa mano privata e audit verificato.
- **Playwright Vite 2/4/8**: importa l'effettivo selettore TypeScript, 7 strade e N owner inclusi zeri, conteggi/bilanci 30, scagnozzo atterrato, mutazioni non ammesse, snapshot falsificati, settlement, rotazione, input immutato e secret non rivelati. Test include il caso futuro 30 occupati e zero liberi.
- **Playwright React 2/8 IT/EN/mobile/no-WebGL**: sette righe, tutti gli owner, lettura standing/fallen, click inspect-only, no command, conservazione dei badge, zero rendering su quota falsa; stato conservato durante turni e settlement.
- **Playwright live API .NET 2/8**: confronto esatto per sette strade e owner con il vero snapshot, `GET /uncontrolled-routes` e `GET /opponent-controlled-routes` con token del posto; slot/quote, postura e zero, click inspect-only senza mutazioni HTTP di partita o cambio revisione. Presence heartbeat indipendente resta consentito.

Riferimenti: [issue #152](https://github.com/KeyserDSoze/Game.Edonism/issues/152), parent #6, #149–#151. Non completa auth/production #13 né stabilisce nuove regole #4/#7/#8. Chiudere solo dopo 3/3 job CI success sullo stesso HEAD finale `main`.
