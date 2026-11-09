# Laboratorio partita React ↔ .NET (issue #20)

**Ambiente:** esclusivamente **Development**. Non è un gioco online né un'implementazione definitiva dei turni. Questo pannello collega il frontend React al core di gioco server-authoritative creato nelle #12, #14, #16, #17 e #18.

## Avvio locale

Usare .NET 10, Node 24 e npm. In un terminale, dalla root del repository:

```bash
ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://127.0.0.1:5080 \
  dotnet run --no-launch-profile --project src/backend/applications/Edonism.Api
```

In un secondo terminale:

```bash
cd src/frontend
npm install
npm run dev
```

Aprire **http://localhost:5173**. Vite indirizza le sole richieste `/api/dev` al backend locale **http://127.0.0.1:5080**. Il proxy non appartiene alla build statica di Production, che non monta il laboratorio grazie a `import.meta.env.DEV`.

## Flusso manuale

1. Scorrere alla card **Laboratorio della partita**. Cliccare «Avvia partita dimostrativa».
2. Il browser invia al backend una **fixture sintetica di prova**: 46 activity IDs, 23 character IDs, 58 action IDs e una carta election-day, tutte **esplicitamente NON ufficiali**, più due giocatori `alice` e `bob`, seed `2026`.
3. Il server valida le quote/corrispondenze, pesca le carte, ricava lo slot e la strada iniziali e risponde con stato pubblico, ID partita e due token effimeri per le due sedute.
4. Scegliere il posto `alice`. La vista mostra la posizione **confermata dal backend**, turno corrente, revisione, vie adiacenti consentite dalla plancia e **solo** quattro IDs della mano associata al token di `alice`. Usare un movimento gratuito; il client invia `destinationStreetId` e `expectedRevision`.
5. Dopo il comando, **solo il risultato server** aggiorna la posizione nel pannello e la selezione della strada 3D. Dopo il movimento gratuito i pulsanti mossa sono disabilitati. Usare «Termina il turno».
6. Passare al posto `bob` (solo per debugging: nella fixture locale il creator possiede entrambi i token), leggere la sua mano e compiere turno/movimento. Al termine il Domain va in `AwaitingRoundSettlement`. **Non** parte un secondo round perché le sue fasi non sono ancora approvate/implementate (#4/#6).

I Pucciottini mesh nella scena restano **decorativi** e non indicano ancora posizioni dei veri giocatori. Il pannello aggiorna soltanto la selezione della strada per rispecchiare la posizione server.

## Autorità, privacy e errori

- Le azioni del browser sono **intenzioni**; non impostano la posizione del giocatore né il saldo. Anche se la UI mostra solo le strade adiacenti, il Domain convalida tutte le mosse.
- La richiesta della mano usa `X-Edonism-Dev-Token`, senza inviare un `playerId` controllabile: la risposta appartiene al **token** e non al posto richiesto via query. Il token e la mano rimangono nello stato **ephemero React**, non in `localStorage` o URL.
- Con risposta `409 Conflict`, il frontend esegue un GET autenticato e aggiorna la revisione/posizione dall'ultimo snapshot server. Non presume che la mossa sia riuscita.
- Se l'API non è raggiungibile, il pannello mostra un messaggio esplicito senza crash. Lingue italiano/inglese, tema scuro/chiaro e viewport mobile sono supportati. Nessuna interazione necessita WebGL, perché i controlli sono HTML.
- Questo non è isolamento sicuro tra **veri** giocatori: la creazione di una fixture Development consegna entrambi i token al creator. Non esporre l'ambiente Development su Internet. Login/sessioni, proiezioni privacy Production e salvataggi sono nella [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13).

## Test

`src/frontend/e2e/development-match.spec.ts` usa mock HTTP deterministici per provare interfaccia e protocollo senza avviare .NET nella CI browser. Testa creazione del fixture (conteggi 46/23/58/1), movimento e revisione, due sedute/turni, fine round, lettura di due mani con token distinti, nessun salvataggio dei token nel browser, risposta 409 con recupero, API non disponibile, traduzione inglese e layout mobile.

Il CI continua inoltre a compilare .NET 10 e lanciare xUnit reali su Domain e API Development (autorizzazione, concorrenza, route assenti in Production). Non presentare i mock Playwright come prova di una partita multiplayer di produzione: rimane necessario un E2E che avvii backend e frontend insieme su ambiente di test quando #13 sarà pronta.

## Non implementato

Catalogo reale e art (#19/#7/#9), lobby, token auth Production, rendering delle pedine sulle posizioni effettive, ownership interattiva, gioco/scarto azioni, fasi elezione/tasse/salario e vittoria PvP. I cinque archi inferiti della plancia attendono conferma designer (#4/R-10).

## Verifica CI conclusa

[GitHub Actions #42685047656](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42685047656) su `main` (`3a7befc`), completed/success: **131/131 xUnit** (0 warning, 0 errori), **10/10 Playwright** (5 nuovi test UI + 5 regressioni plancia), compilazione .NET 10 e build TypeScript/Vite superate. Gli smoke Playwright usano un fake HTTP verificabile e non avviano un server .NET reale nello stesso processo; i test xUnit di integrazione dell'API coprono il backend.
