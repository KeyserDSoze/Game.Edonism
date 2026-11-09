# Attività controllate e scagnozzi visibili nella città 3D (#23)

## Origine e limiti delle regole

**Regolamento stampato `rulebook2.zip`:** p. 4 assegna al personaggio la sua attività iniziale e uno scagnozzo in piedi; p. 5 calcola un **preventivo lordo** di 2 atomi base più uno per attività controllata con scagnozzo in piedi. Il core ha introdotto queste proiezioni nella #14; le 30 carte distribuite negli slot sono nella #16. La #23 **non** implementa nuove azioni, conquista di proprietà, Pizzo, tasse, pagamenti, salari netti o elezioni, ancora in #6/#7/#8/#4.

## Flusso dei dati — solo pubblico e read-only

L'API `Development` espone `MatchSnapshot` con `players`, `boardActivities` (30 `{slotId,cardId,category}`), `controlledActivities` (slot, proprietario, postura `0=Standing`, `1=Fallen`) e `grossSalaryQuotes` (base, attività in piedi, lordo). Il laboratorio React invia all'App soltanto questi campi pubblici **e non** le credenziali, le mani, il mazzo, i token o altri dati privati.

`src/frontend/src/features/city/activityMarkers.ts` ricostruisce una proiezione puramente grafica usando gli ID e il file canonico `edonism-board.v1.json`:

1. Un lotto rende l'indicatore di controllo **soltanto** quando esiste esattamente una carta attività pubblica per il suo slot, una relazione di controllo, un proprietario tra i giocatori conosciuti e una postura valida. Slot inesistenti, carte mancanti, proprietari ignoti e ID duplicati non generano scagnozzi fittizi.
2. Il lotto è individuato tramite `slotId` nel JSON condiviso. Le coordinate `x/z` derivate da `toScene` servono soltanto al disegno 3D: **non** sono coordinate di gioco né vengono inviate ai comandi backend.
3. La piastra dell'edificio prende il colore del giocatore (la stessa palette dei Pucciottini #22). Una pedina geometrica verticale rappresenta uno scagnozzo `Standing`, una pedina orizzontale `Fallen`. La differenza di postura è intenzionale, non implica che Pizzo o altre azioni che la cambiano siano implementate.
4. I gross salary quotes vengono **letti**, non ricalcolati o versati dal client. La vista indica espressamente che non si tratta di atomi accreditati né di saldo netto.

Se non è in corso una partita la scena resta un'anteprima statica e **non** crea controlli inventati. Quando un match viene creato o un comando è accettato, `DevelopmentMatchLab` pubblica i campi dallo snapshot .NET. In caso di `409` legge di nuovo lo stato con il token appropriato e aggiorna la scena dal GET server. Un cambio posto per la debug fixture o una selezione di strada/slot dell'ispettore **non** modifica proprietari, posture o salari.

## Interfaccia e accessibilità

La mappa rimane navigabile in React Three Fiber, con geometrie procedurali in attesa degli asset originali (#9/#19). Sotto il Canvas compare un elenco DOM accessibile e responsive che indica per ogni attività **controllata**: lotto, ID carta e categoria **sintetici** quando sintetici sono i dati di fixture, proprietario e postura. Nello stesso pannello sono mostrati i preventivi **lordi** del server. L'interfaccia è IT/EN e utilizzabile senza WebGL.

Le attività non controllate restano edifici neutrali. Il programma non afferma che uno scagnozzo caduto produca salario; non altera l'ordinamento/numero dei 30 slot della #5 e non interpreta le carte ufficiali.

## Test

- **xUnit Domain (#23):** full-deck 30 carte uniche, due controlli in due slot validi, uno scagnozzo in piedi per giocatore, preventivo 2+1=3 lordi con saldo iniziale ancora 4; movimento valido, respinto e cambio turno non spostano il controllo e non accreditano denaro.
- **Playwright UI con HTTP mock:** join lotto/carta/controllo, colori e ID pubblici, posture Standing/Fallen, lordo non pagato, scagnozzi non inventati con owner/slot/carta invalidi, invarianza dopo movimento/cambio posto, fallback WebGL, inglese/mobile e `409`.
- **Playwright live:** partita con API ASP.NET Core Development reale, 30 carte e 2 attività controllate; attributi DOM dei lotti confrontati con `controlledActivities`/`boardActivities` JSON server, salari lordi e invarianti dopo i turni/refresh `409`.
- **Security:** token e mani restano confinati al laboratorio, nessuna nuova route Production. Testare l'interazione non equivale ad autenticazione PvP Production (#13).

Le mesh e gli ID delle carte dell'esempio sono **provvisori**. I file delle carte singole e le attribuzioni originali non sono ancora importati (#19). Il regolamento non viene riempito con decisioni arbitrarie.

La CI finale e i conteggi esatti saranno registrati nel ledger e nella issue #23 prima della chiusura.
