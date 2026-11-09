# Laboratorio Development da 2 a 8 giocatori — #27

## Obiettivo

La API .NET 10 e il Domain già gestivano fixture da 2 a 8 posti; il browser ne creava solo due. Nel pannello React **solo Development**, il creatore seleziona ora un numero di posti da 2 a 8 (default 2 per le regressioni esistenti). I nomi sintetici sono ordinati e stabili: `alice`, `bob`, `charlie`, `diana`, `eve`, `frank`, `grace`, `heidi`. L'intero setup e i turni restano autoritativi nel Domain; nessun attore viene spostato in React.

## Fixture sintetica compatibile con le quote

I **46 ID attività**, **23 ID personaggio** e **58 azioni + 1 Giorno dell'elezione** rimangono *dati fittizi*, non materiale ufficiale di #19.

Il catalogo iniziale precedente prendeva i primi 23 ID in ordine alfabetico, concentrando troppi personaggi in poche categorie. Con 8 giocatori estratti si rischiava di superare le quote dei 30 spazi (R-03). La selezione di 23 starting card è adesso effettuata in modo circolare sulle categorie, scegliendo solo le prime `quota` attività per ciascuna delle otto categorie stampate: 5+5+4+4+4+2+3+3 = 30 possibili. Poiché ogni personaggio sintetico ha una starting card distinta tra queste 30, **qualsiasi sottogruppo di 2–8 personaggi estratti** rispetta la quota della propria categoria, senza introdurre un algoritmo di compensazione inventato. Il server continua a calcolare shuffle, piazzamento e strada iniziale.

## Credenziali, confini e UX

- Il creator riceve le credenziali di *tutti* i posti (solo fixture Development) e può ispezionare un posto alla volta; griglia dei posti responsive. I marker della città e gli scagnozzi dipendono sempre dalla proiezione pubblica del server.
- Un altro browser entra con UUID della partita e **solo** il token del suo posto; il player ID deriva esclusivamente da `GET /hand` autenticato, non dall'input client. Vede solo la propria mano e non può cambiare identità verso altri posti.
- Token e mani non sono salvati in URL, storage locale/sessione o WebGL. Se la pagina viene ricaricata, occorre reinserire esplicitamente UUID/token. Il checkpoint opt-in #26 riguarda il **server**, non il browser.
- Il limite del primo round e `AwaitingRoundSettlement` è invariato. Non sono aggiunte autenticazione Production, carte reali, poteri, combattimento, votazioni, stipendi o nuove regole.

## Regressioni

Playwright mocked: selezione 8 posti, locale inglese e viewport mobile, quote del catalogo, roster 3D/DOM, cambio posto, sola mano privata e assenza di token da body/URL/storage. Playwright live: create HTTP reale da React con 8 posti/30 attività, 8 controlli e 8 personaggi, join di `heidi` da browser distinto, disgiunzione delle 32 carte private, otto comandi `end-turn` server-authoritative con revisioni 1…8, polling e blocco al termine del primo round.

Il job xUnit .NET e le suite UI preesistenti restano obbligatori. Stato finale CI e chiusura saranno registrati nella [issue #27](https://github.com/KeyserDSoze/Game.Edonism/issues/27) e nel [ledger](development-ledger.md).
