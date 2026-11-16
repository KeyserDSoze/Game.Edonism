# #149 — Atlante dei lotti con carte pubbliche non controllate

## Scopo

L'attività stampata già scoperta sulla plancia è **pubblica**. In un fixture Development a mazzo completo il server .NET conserva e trasmette `boardActivities` con **30** carte su altrettanti slot stampati, e `controlledActivities` con gli scagnozzi/proprietari attuali. Prima di #149 il pannello cittadino mostrava visivamente soltanto le carte dei lotti controllati e il numero totale di carte; i lotti liberi richiedevano di consultare separatamente le rotte del laboratorio.

La nuova sezione città **Attività pubbliche non controllate** / **Public uncontrolled activities** consente di esplorare i lotti pubblicamente visibili senza introdurre compravendite o altre azioni di gioco. Gli ID sono **tecnici/sintetici**, non i nomi o l'arte delle carte originali (#19).

## Provenienza e validazione fail-closed

`verifiedPublicUncontrolledBoardActivities` è una pura proiezione read-only, senza fetch:

- accetta solamente un roster di **2–8** posti con ID tecnici validi e distinti, ciascuno in una strada canonica; richiede la proiezione dei marker completa;
- esige `verifiedPublicBoardCardCount(snapshot) === 30`: slot stampati e ID fisici univoci, categorie stampate, quote esatte (5 finanziamenti pubblici, 5 privati, 4 mercato nero, 4 corruzione, 4 cultura, 2 sport, 3 trasporti, 3 vescovato) #140–#143;
- richiede che `controlledLotMarkers` riesca a proiettare esattamente **tutti** i controlli presenti. Nessun lotto con controllo duplicato, proprietario ignoto o postura invalida può essere mostrato come erroneamente libero;
- sottrae esclusivamente gli slot controllati dalla plancia completa e restituisce ogni altra carta con `slotId`, `streetId`, `cardId` e `category`, in ordine di slot della plancia originale;
- su qualsiasi incoerenza restituisce **lista vuota**: mai un sottoinsieme plausibile di carte sconosciute. Fixture parziali da 0–29 carte non dichiarano un board completo e non mostrano l'atlante. Invece i relativi altri pannelli, i marker, le carte personaggio, l'economia e i comandi continuano a usare i loro controlli indipendenti;
- non dipende da salari o altri dati economici, non legge carte private/fazioni/credenziali, non ricostruisce regole per comprare/attaccare/spostarsi.

Nella UI l'atlante è un `<details>` collassato di default: i **22–28** lotti liberi non riempiono l'intera schermata. Ogni bottone è un **inspect-only** che invoca `chooseSlot` sul lotto stampato, senza POST, senza alterare revisioni, turni o sessione.

## Test

- **xUnit 2/4/8:** `GameMatch.CreateFromTrustedFullDeckSetup` reale, quote categoria stampata, carte e ID unici, esattamente 30−N lotti liberi, confronto carte/slot/strade con `VerifiedUncontrolledRoutesForActor` per ogni posto, prima/dopo mossa e end turn; nessuna mano privata nello snapshot pubblico.
- **Playwright Vite 2/4/8:** import del vero selettore TypeScript, verifica ordine e 30−N carte, carta con ID duplicato, lotto stampato duplicato o straniero, quota categoria falsa, controlli doppio/straniero/proprietario straniero/postura invalida, roster scorretto, partial board, input immutato, assenza token/mano.
- **React mocked 2/8:** 30 carte ma 2 lotti controllati nel fixture sintetico, quindi **28** righe; pulsante ispezione, IT/EN/mobile/no WebGL, 30 pubbliche e 2 controllate restano distinte, saldo/turno non alterati, lista assente su quota falsificata.
- **Playwright live .NET 2/8:** elenco completo dei **28/22** lotti liberi uguale ai dati dell'endpoint autentico `/uncontrolled-routes`; anche click inspect-only a 2 giocatori senza modificare la revisione.

Il backend .NET continua a essere autoritativo; questo **non** è uno shop, non concede proprietà, acquisti o interazioni PvP, non è Production (#13). Le regole delle carte e gli asset restano aperti (#4/#7/#19). Issue: [#149](https://github.com/KeyserDSoze/Game.Edonism/issues/149). Chiusura soltanto con tutti i tre job CI verdi sullo stesso HEAD di `main`.
