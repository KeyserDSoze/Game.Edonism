# Edonism — baseline delle regole stampate

**Stato:** trascrizione/analisi per progettazione, non implementazione approvata.  
**Fonte prioritaria:** `rulebook2.zip`, immagini del regolamento italiano stampato.  
**Convenzione:** i riferimenti `[p. N]` indicano `rulebook2/N.png`; le lacune sono in [open-questions.md](open-questions.md).

## 1. Obiettivo e perimetro [pp. 3, 21]

Tema: lotta fra persone influenti per il controllo della città di Edonism, con squadre segrete **White** e **Black**, ruoli **Boss** e **Politician** e, quando i giocatori sono dispari, possibile fazione **Bifaccia**.

**Vittoria di fazione [p. 21]:**
1. la fazione arriva a possedere **16 attività**;
2. si uccide il capo della fazione avversaria (Boss per Black, Politician per White secondo l'esempio testuale).
Solo Boss/Politician, dopo essersi rivelati, possono **dichiarare** la vittoria. Dichiarazione falsa: vedere esempio p. 21 (la fazione dichiarante perde).

**Vittoria Bifaccia [p. 21]:** se non corrotto può vincere da solo possedendo **8 attività** oppure uccidendo tutti tranne Boss e Politician. La prima corruzione lo vincola a una fazione e annulla la sua possibilità di vittoria solitaria [pp. 19–20].

Non sono citate quest card come sistema di vittoria nella versione stampata; compaiono invece nel documento storico inglese. **Non introdurle senza decisione esplicita.**

## 2. Componenti e preparazione [pp. 3–4]

Inventario dichiarato dalla stampa: **58 carte azione** + **1 carta Giorno dell'elezione**, **46 carte attività**, **23 carte personaggio** e altrettante lapidi, **11 carte fazione**, **8 grandi opere**, **8 pedine colorate**, **40 cuori**, **128 scagnozzi** (16 per colore), **20 token corruzione White**, **20 token corruzione Black**, **20 token diplomazia**, **10 stick costruzione**, **10 stick distruzione**, denaro `atom` in tagli 1/2/3 e una plancia.

- Mescolare i personaggi, assegnarne uno visibile per giocatore, con una **attività iniziale associata** al ruolo. Municipio al centro (**Main Square**).
- Preservare in gioco le attività obbligatorie dei personaggi estratti, poi estrarre fino a raggiungere **30 attività**: 5 finanziamenti pubblici (celeste), 5 privati (rosso), 4 mercato nero, 4 corruzione (giallo), 4 cultura (rosa), 2 sport, 3 trasporti (bianco), 3 vescovato (viola). Se una classe supera il contingente per attività iniziali obbligatorie, compensare come specificato in p. 4: servono esempi/test aggiuntivi per generalizzare l'algoritmo.
- Disporre casualmente le 30 attività nei **30 spazi grigi** della plancia.
- Mescolare le fazioni; con numero dispari di giocatori aggiungere **Bifaccia**. Fazioni segrete, personaggi visibili. Ciascuno conosce soltanto la propria fazione.
- Ogni giocatore: vita iniziale indicata dal personaggio, **2 token diplomazia**, **4 atoms**, **16 scagnozzi**, propria pedina/lapide. Pedina sulla strada della propria attività iniziale; mettere uno scagnozzo sull'attività iniziale.
- Mescolare carte azione e carta `Giorno dell'elezione`, distribuirne **4 a ogni giocatore**. Inizia un giocatore selezionato; ordine in senso orario.

L'allocazione esatta di carte fazione in funzione del numero di giocatori e del totale dei personaggi va formalizzata dopo validazione del deck [questioni aperte].

## 3. Fasi di gioco [pp. 5–6]

Ordine del ciclo descritto:
1. **Dichiarazione carte:** il primo giocatore dichiara quante carte devono rimanere in mano a fine turno; p. 6 precisa che può giocare da una a due carte; se ne possiede più di quattro, deve arrivare almeno a tre.
2. **Turno:** ogni giocatore agisce con il vincolo di carte in mano; può reagire con istantanei anche durante il turno di altri.
3. **Gli ultimi saranno i primi:** l'ultimo giocatore diventa primo e l'ordine ruota; il precedente primo diventa secondo.
4. **Salario:** per giocatore, **2 atoms** base + **1 atom per attività con scagnozzo in piedi**; non contano le attività con scagnozzo atterrato dal Pizzo. Si detraggono eventuali tasse; modifiche da Innovate.
5. **Rifornimento:** solo se **tutti i giocatori hanno esaurito la mano**, si pescano 4 carte (5 con un Draw, 6 con @ e # cumulati). Gli esempi chiariscono che, se anche uno ha ancora carte, il rifornimento viene saltato.
6. **Giorno dell'elezione:** quando pertinente (p. 5 parla della carta rivelata a rifornimento oppure di primo turno; verificare esatta condizione).
7. **Tasse:** il sindaco può ridefinire tasse e finanziare una grande opera.
8. **Alzatevi scagnozzi:** tornano in piedi gli scagnozzi atterrati.

Le regole di ripescaggio, il vincolo di carte e la temporizzazione degli istantanei sono un **motore di stati**, non un semplice contatore React.

## 4. Azioni e mappa [pp. 6–8, 20]

In un turno un giocatore può, in qualunque ordine e nel rispetto dei limiti e delle carte:
- movimento gratuito **una volta per turno**, verso una strada adiacente;
- usare una carta azione per movimento addizionale;
- usare potere da attività come azione gratuita oppure azione pagata sul lato inferiore destro della carta (costo stampato);
- fare scambi, comprare un'attività (una gratuita per turno, ulteriori con carte), comprare servizi da giocatori;
- usare una carta per richiedere **Pizzo** (riceve 2 atoms e atterra uno scagnozzo dell'attività);
- depositare una carta in **Cassaforte**, max una, che può essere giocata poi ma non rimessa in mano né sostituita prima dell'uso.

Acquisto attività libera: il personaggio deve essere sulla relativa **strada**, non devono esserci scagnozzi di altri e si paga il costo stampato; si mette uno scagnozzo sulla proprietà. Le strade (vedi legenda p. 8 e tavola originale) sono **Einstein Avenue, Gauss Avenue, Newton Avenue, Planck Avenue, Meson Street, Boson Street e Main Square**. Nella p. 7 esempi di adiacenza: Planck ↔ Gauss, Einstein, Meson; Einstein ↔ Planck, Newton, Main Square. **Il grafo completo va ricostruito**, non derivato dagli esagoni del renderer.

**Prima mossa aggressiva [p. 20]:** al primo turno nessuna azione può infliggere perdita di cuori; i danni e Blackmail che toglie cuore sono permessi dal secondo turno.

## 5. Scambi e servizi [pp. 7, 11, 15]

Oggetti scambiabili: **attività**, **token diplomazia**, **carta in cassaforte** senza rivelarla prima, **atoms**. Non si possono scambiare atoms per atoms, token diplomazia per attività, carta in cassaforte per attività, né fare scambi gratuiti. Prezzi minimi: token diplomazia **1**, carta in cassaforte **2**, attività **3** atoms.

Un servizio da un altro giocatore usa potere nella pool del venditore. Prezzo di base deciso da lui, minimo **2 atoms**; deve essere rispettata la strada del potere. Se l'attività è corrotta, un altro giocatore può usarla per **1 atom pagato al municipio**, e il proprietario non può opporsi [p. 7].

Gli scambi di proprietà cambiano il controllo/scagnozzo, non cancellano stick costruzione/distruzione né token corruzione [p. 11]. Il potere passivo Transfer può applicarsi.

## 6. Sindaco, elezione, imposte, grandi opere [pp. 9–10]

- L'elezione si attiva tramite `Giorno dell'elezione` durante il rifornimento oppure secondo la condizione del primo turno nella sezione Fasi.
- Candidature, breve presentazione, voto **segreto**; in caso di parità si ripete il voto tra i candidati pari, se rimane il pareggio l'elezione è annullata e resta il sindaco uscente (o nessuno). Carta elezione torna nel mazzo mescolato dopo l'evento.
- Il sindaco controlla il **municipio**, che conta ai fini della vittoria, ma non può essere venduto, distrutto, costruito o corrotto; dispone dei relativi poteri.
- Sindaco: vita massima **5** e +1 cuore all'elezione; nel caso di destituzione non mantiene vita bonus salvo sia già entro limite normale.
- Imposta sul salario modificabile dal sindaco fra **0 e 2 atoms**; la tassa raccolta nella fase Salario alimenta il municipio, finanzia le grandi opere.
- **8 grandi opere**: finanziamenti pubblici **13**, privati **15**, mercato nero **12**, corruzione **14**, sport **10**, trasporti **8**, vescovato **12**, cultura **11** atoms. Una grande opera sblocca le istanze di potere `#` delle attività della relativa categoria.

Non importare le vecchie tasse/commissioni speciali del PDF inglese senza verifica: il regolamento più recente descrive un'imposta sul salario.

## 7. Poteri e carte [pp. 12–16]

- Il potere ha **tipo** cuore (danno/vita), lente (informazioni) o strada (altri effetti); e **velocità** attivo (nel turno), passivo (sempre), istantaneo (anche turni altrui).
- Istanza `@` della proprietà o del personaggio e istanza `#` sbloccata da grande opera. **Istanze dello stesso tipo non si sommano**; `@` + `#` invece possono sommarsi/potenziarsi. Il giocatore può scegliere di usare una sola istanza.
- I poteri attivi/istantanei richiedono presenza propria o di uno scagnozzo sulla strada del bersaglio, salva regola specifica.
- **Attivi:** Heal, Inquire, Blackmail, Jail, Damage, Drug, Wreck, Steal, Corrupt.
- **Passivi:** Discount, Innovate, Transfer, Draw, Stamp, Speed.
- **Istantanei:** Build, Protect, Spy, Drink, Deny, Vote.
- **Reazioni:** `Protect` annulla `Drink`, `Drink` annulla `Deny`, `Deny` annulla `Protect`. Vanno gestite catene di contrapposizioni e la scelta del bersaglio.
- **Build:** +**3 atoms** allo stake, un stick; **2 stick** rendono l'attività indistruttibile e immune alla corruzione. Può contrastare Wreck.
- **Wreck:** -**3 atoms** per stick. Se valore <=0, l'attività viene distrutta e rimpiazzata con un'altra pescata dal mazzo fuori gioco; lo scagnozzo presente viene rimosso e il proprietario perde l'attività.
- Personaggio: all'inizio disponibile il solo primo potere `@` o `#`; il potere secondario si sblocca quando viene costruita la prima **grande opera**, indipendentemente dal tipo [p. 16].

I singoli costi ed effetti, compresi i casi `@` + `#`, sono nella fonte paginata: **non** trascrivere il catalogo in valori definitivi dal solo screenshot delle miniature. Servirà un catalogo dati versionato della carta per l'issue #7.

## 8. Messaggi e segreti [p. 17]

Ogni giocatore ha 2 token diplomazia iniziali e può inviare messaggi **privati** ad altri giocatori usando token o poteri. Il destinatario può rispondere una volta sullo stesso messaggio. L'ID è progressivo e include personaggio mittente/destinatario. `Spy` permette di leggere un messaggio nel modo previsto dal potere.

**Implica privacy multiplayer:** non distribuire contenuto di messaggi o carte fazione a client non autorizzati per poi nasconderli via UI.

## 9. Corruzione e stato della fazione [pp. 18–20]

- Esistono token corruzione **White** e **Black** per attività e personaggi; la visibilità o meno della fazione determina vincoli di applicazione.
- Attività corrotta: anche altri giocatori con fazione coperta possono usarne il potere sulla relativa strada, pagando **1 atom al municipio**. Il proprietario lo può utilizzare a pagamento senza dover stare sulla strada [p. 19].
- Personaggio corrotto con fazione opposta: le sue attività non contano per la vittoria della fazione e non può utilizzare Corrupt [p. 19].
- `Corrupt` ripetuto può rimuovere o cambiare il token. La corruzione non ha effetto su Boss e Politician con fazione rivelata e su attività con 2 stick Build [p. 18].
- Rimozione token dal proprio personaggio: **6 atoms**; da attività (stessa strada) **5 atoms**; altre possibilità con poteri Corrupt/Drink/Build seguono pp. 18–19.
- Bifaccia: prima corruzione rivela/converte la fazione definitivamente e toglie la vittoria personale [pp. 19–20].

## 10. Fine partita e morte [pp. 20–21]

Un personaggio a zero cuori muore. Qualunque giocatore può salvarlo sacrificando uno scagnozzo su un'attività lungo la **stessa strada** (anche se si trova in squadra avversaria); perde quell'attività.

Alla morte: rivelazione fazione; atoms nel fondo comune; token diplomazia al giocatore che lo ha ucciso; pedina rimossa dalla plancia; tutti gli scagnozzi tolti dalle attività; attività ritornano libere mentre token corruzione/stick rimangono. Scagnozzi rimossi possono essere **riutilizzati** [p. 20].

## 11. Design del software proposto — NON REGOLA DEL GIOCO

È una possibile mappatura server-authoritative, da affinare con issue e test:
- `RuleSetVersion`, `BoardDefinition` (street graph + `ActivitySlot`), `CardDefinition` e `PowerDefinition`;
- `Match` e `PlayerState` con proiezioni pubbliche e segrete; `TurnPhase`, `PendingReaction`, `PendingVote`;
- `MatchCommand` rappresenta intenzioni autorizzate, `GameEvent` mutazioni deterministiche con versionamento e audit;
- `MatchViewFor(playerId)` proietta soltanto informazioni che quel giocatore è autorizzato a conoscere;
- Three.js visualizza lo stato; non determina pagamenti, vittorie, danni, voti, corruzione o posizione valida;
- xUnit parametrizzato su core regole, test di contract/integration per privacy e autorizzazioni, Playwright per flussi UI reali.

Le questioni aperte sono parte del contratto: nessuna ambiguità va trasformata silenziosamente in costante di codice.
