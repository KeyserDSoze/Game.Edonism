# Bootstrap atomico del posto — Development-only (#32)

## Obiettivo e vincoli

Un nuovo giocatore che entra nella fixture PvP-first di Edonism deve ottenere tre informazioni: lo snapshot pubblico, **la propria** mano riservata e le azioni al momento consentite dal Domain (#29). Prima della #32, React chiamava più endpoint indipendenti; un movimento, fine turno o rotazione di credenziale (#28) fra le risposte poteva produrre viste iniziali di **revisioni differenti**. Questa tranche risolve il bootstrap del singolo browser **solo Development** senza inventare fasi o regole canoniche #4.

## Contratto della API

```http
GET /api/dev/matches/{matchId}/seat
X-Edonism-Dev-Token: <token-esadecimale-256-bit-del-posto>
```

Risposta `200 OK` con `Cache-Control: no-store`:

```json
{
  "matchId": "00000000-0000-0000-0000-000000000020",
  "playerId": "bob",
  "state": { "matchId": "…", "revision": 2, "players": [], "events": [] },
  "hand": { "matchId": "…", "playerId": "bob", "cardIds": ["…"] },
  "turnOptions": {
    "matchId": "…",
    "playerId": "bob",
    "revision": 2,
    "canEndTurn": true,
    "freeMoveStreetIds": []
  }
}
```

Il JSON è un esempio di forma e i campi non mostrati dello snapshot pubblico esistono ancora. In particolare nessun token, digest, deck/checkpoint, mano di altri attori o credenziale del creator compare nella risposta.

**Autorizzazione:** il server risolve `playerId` esclusivamente dal bearer, confrontato con i digest SHA-256 dello store; non usa campi client o query `playerId`. Credenziali mancanti, sconosciute, ruotate o partita inesistente producono `404` indistinguibile. In Production la route non è registrata.

## Atomicità server e confini

Il `DevelopmentMatchStore.TryBootstrapSeat` acquisisce una volta il lock di `Entry.Gate`, condiviso con rotazioni, movimenti, fine turno e sostituzione di checkpoint. Con quel lock valido legge mano privata dell'attore, `MatchTurnOptions` e `MatchSnapshot`, verificando match, attore e `Revision` identici prima di restituire `DevSeatBootstrap`. La risposta non muta stato, revisione, eventi o carte. L'operazione è coerente **all'istante della lettura**, non riserva il turno: un altro giocatore può avanzare la revisione subito dopo l'HTTP 200, quindi i comandi continuano a ripetere validazione e controllo della revisione.

Con file AES-GCM Development (#26), anche un nuovo processo può caricare il checkpoint e risolvere il bearer corrente per costruire lo stesso bootstrap; il token precedente resta revocato dopo una rotazione #28.

## Client React

Sul click *Entra nella partita*, React fa una sola richiesta all'endpoint `/seat` e verifica che i campi `matchId`, `playerId`, `hand.playerId`, `turnOptions.playerId`, `state.revision` e `turnOptions.revision` coincidano. Richiede mano e lista strade come array prima di installare `session`, `hand` e autorizzazioni. Un fallimento blocca la sessione e non pubblica la proiezione 3D o la mano.

Il bootstrap valido **inizializza direttamente** mano e opzioni, saltando solo le due fetch iniziali ridondanti legate a identità e revisione della prima lettura. Cambi successivi di posto, revisione, token e i poll HTTP 304/200 seguono il workflow precedente; una revoca #31 nasconde la mano e permette il rejoin. Le credenziali rimangono in sola memoria React, mai in URL, storage o vista pubblica.

## Verifiche

- **xUnit HTTP**: accettazione 200+no-store con due attori, query `playerId` ignorata, nessun token/cardId altrui, sincronismo stato/opzioni, progressione dei turni, 404 revocato, route assente in Production.
- **xUnit store**: checkpoint cifrato riaperto con nuova istanza e credenziale ruotata; letture durante un comando concorrente sempre con un'unica revisione per mano, stato e opzioni.
- **Playwright UI mocked**: un solo `/seat` per join, niente `/hand` o `/turn-options` duplicati all'avvio, dati mismatch/revisione errata respinti, mobile/EN e WebGL fallback.
- **Playwright live**: browser separato con singolo bearer reale, risposta privata actor-scoped, comandi e aggiornamento del round con API .NET vera.

### Cosa resta fuori

Non viene aggiunta alcuna identità Production, gestione account, durabilità multi-processo, distribuzione di carte, risoluzione azioni, tasse, elezione o settlement. #13 (Production auth/DB) e #4/#6 (regole e motore) restano aperte. Non scambiare i cataloghi sintetici Development per carte ufficiali: #19 è aperta.

Seguire la [issue #32](https://github.com/KeyserDSoze/Game.Edonism/issues/32), il [ledger](development-ledger.md) e la CI effettiva prima di considerare completata la tranche.
