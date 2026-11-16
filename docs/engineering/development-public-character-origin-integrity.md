# #145 — Collegamento delle carte personaggio ai lotti iniziali pubblici

## Scopo

Edonism 0.0.2, **sola visualizzazione Development**. Il catalogo reale delle carte non è ancora disponibile (#19) e non vengono introdotti poteri, turni, soldi, attacchi o autentificazione Production (#13).

## Vulnerabilità di rappresentazione

La verifica precedente #141 confronta il valore dei cuori già pubblico sui giocatori con quello dei personaggi assegnati, assicurando ID distinti. Su una partita con 30 carte attività, però, `startingActivityCardId` poteva indicare una carta di un altro lotto, o un ID estraneo alla plancia, e i badge dei cuori continuavano ad apparire genuini.

## Invariante verificato (#145)

Quando `boardActivities` contiene **esattamente 30 record** (la plancia stampata completa), per **ciascuno** dei 2–8 giocatori con personaggio:

1. il giocatore ha un `startingSlotId` appartenente ai 30 lotti stampati;
2. esiste **una e una sola** carta pubblica con `cardId === assigned.startingActivityCardId`;
3. esiste **una e una sola** carta pubblica nello `startingSlotId` di quel giocatore;
4. i due riferimenti devono identificare lo **stesso** record. Il confronto è ordinal e case-sensitive.

Una sola incoerenza nasconde **tutti** i badge cuori, senza accettare una provenienza parziale ingannevole. Le verifiche già esistenti di cuori 1–5, assegnazioni e unicità rimangono. Le carte non interessate dai lotti iniziali non influenzano questo specifico badge: conteggio plancia, quote salariali e risorse hanno validatori indipendenti (#140–144). Le fixture sintetiche incomplete (meno di 30 record) e quelle legacy senza personaggi conservano il comportamento #141.

**Non è una validazione di regole/combattimento**: il Domain .NET rimane autoritativo e il browser non decide una carta utilizzabile o un risultato PvP.

## Test

- xUnit Theory 2/4/8: `GameMatch.CreateFromTrustedCharacterCatalog` associa sempre carte, slot e cuori; controllo di stabilità dopo movimento e fine turno, audit invariato.
- Playwright vero Vite/TypeScript 2/4/8: plancia da 30, carta iniziale con ID estraneo, card nel lotto sbagliato, swap, duplicati carta/lotto, casing alterato, lotti incongruenti, input immutabile. Una modifica su carta non correlata non sopprime i cuori. Le fixture parziali restano supportate.
- Playwright React mock 2/8, mobile/no WebGL e IT/EN: input validi mostrano i cuori; associazioni false li nascondono lasciando quote, risorse, posizioni e turno corretti.
- Playwright React + API .NET reale 2/8: confronta `assignedCharacters`, `boardActivities` e `players.startingSlotId` sulla stessa fotografia pubblica.

Issue di tracking [#145](https://github.com/KeyserDSoze/Game.Edonism/issues/145); chiudere solo dopo CI completa verde 3/3 sull'ultimo commit `main`.
