# #151 — Distribuzione pubblica delle attività libere per strada

## Scopo

Il PvP di Edonism usa il grafo originale a **sette strade** e una plancia pubblica di **30 attività**. Dopo #149 (atlante completo dei lotti pubblici non controllati) e #150 (filtri per strada e categoria), la città espone un riepilogo di **quante attività libere** sono visibili su ciascuna strada.

Questo è **scouting pubblico**: il conteggio non rappresenta una distanza d'attacco, possibilità di acquistare, requisiti di controllo, costo, strada percorribile nel turno o autorizzazione a cambiare stato.

## Invarianti / provenienza

- `verifiedPublicFreeActivityStreetDistribution(snapshot)` chiama `selectVerifiedPublicUncontrolledActivities(snapshot, {streetId:"", category:""})` sulla **fotografia completa**, che riusa il fail-closed #149. Nessun conteggio è calcolato da un sottoinsieme di `boardActivities` non verificato, o da una mano privata.
- Se la validazione della plancia completa fallisce (quote, slot, ID fisici, 2–8 player, controlli di attività, owner, posture), l'intera distribuzione è **vuota**; l'atlante stesso è nascosto. Non sono mostrati numeri parziali apparentemente autorevoli.
- Per una plancia valida vengono restituite **tutte e sette** le strade in ordine `cityBoard.streets` con `streetId`, nome canonico e numero di attività libere. Una strada con **0** lotti liberi resta visibile e cliccabile. La somma è esattamente il numero di attività pubbliche non controllate (30−N su full-deck reale con N controlli iniziali).
- I conteggi sono ottenuti dalla lista non filtrata, rimangono invariati quando un utente applica i filtri #150 e non cambiano al variare della posizione o del proprietario del turno, in assenza di modifiche ai lotti.
- La sezione compare **dentro l'atlante collassabile**, tradotta IT/EN, con sette pulsanti accessibili su desktop, mobile e fallback senza WebGL. Premere un conteggio seleziona il **filtro strada** e azzera il filtro categoria; non esegue POST o azioni di partita. Nessuna credenziale o carta privata è serializzata.

## Test regressione

- **xUnit vero Domain .NET 2/4/8**: ogni strada e ogni posto ottiene esattamente il conteggio risultante da `VerifiedUncontrolledRoutesForActor` e dallo `Snapshot` pubblico; la distribuzione non cambia dopo free move o end turn, mentre audit/checkpoint privato e lotti restano invariati.
- **Playwright Vite 2/4/8**: sette conteggi, ordine esatto rispetto al JSON condiviso, somma 30−N, strada con zero, nessuna perdita di dati privati, fallback a `[]` su lotti/carte/attori falsi.
- **Playwright React mock 2/8**: sette pulsanti, conteggi della fixture (7,7,3,3,4,4,0), click che applica solo il filtro e azzera la categoria, cambio lingua IT/EN, mobile/no WebGL, nessun comando di gioco e invarianza del totale.
- **Playwright live React + API .NET 2/8**: somma e conteggi di tutte le strade coincidono con le rotte restituite da `/uncontrolled-routes` con bearer valido, filtraggio senza mutazioni della revisione.

Issue [#151](https://github.com/KeyserDSoze/Game.Edonism/issues/151) nel backlog, parent #6. Dipende da #149 e #150. Regole ancora aperte #4/#7/#8, niente Production auth #13. Chiudere soltanto dopo CI 3/3 green sullo SHA finale di `main`.
