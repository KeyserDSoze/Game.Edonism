# Presenza di posti PvP — laboratorio Development (#38)

## Obiettivo

Durante una partita a due–otto giocatori, l'interfaccia deve poter indicare quali **posti** hanno inviato un segnale di attività recentemente. Questo aiuta a distinguere, nel laboratorio con più browser, una postazione ancora presente da una probabilmente inattiva. Non si tratta né di login, né di heartbeat transport-specific per il game engine, né di prova dell'identità di un utente. Non autorizza turni e non produce eventi.

## API e autenticazione

```http
POST /api/dev/matches/{matchId}/presence
X-Edonism-Dev-Token: <capability privata del posto>
```

Aggiorna il tempo dell'ultimo segnale **solo** dell'attore derivato dal bearer valido. Nessun body è necessario; un `playerId` in body o query non influenza il posto. Risponde 200 con lo stato aggregato attuale, per esempio:

```json
{
  "matchId": "00000000-0000-0000-0000-000000000020",
  "seats": [
    { "playerId": "alice", "isActive": true },
    { "playerId": "bob", "isActive": false }
  ]
}
```

`GET /api/dev/matches/{matchId}/presence` è **read-only**: non rinnova l'attività del richiedente. Entrambe le route sono Development-only e richiedono il token. Bearer assente/falsificato/revocato, match inesistente o route in Production: 404. Il middleware #33 aggiunge `Cache-Control: no-store`, `Pragma: no-cache`, `Expires: 0` a tutti gli status. Non vengono trasmessi token, digest, hands, mazzi, timestamp o dettagli di connessione.

## Semantica temporale, concorrenza e sicurezza

Sotto il medesimo `Entry.Gate` usato per le letture/azioni, `DevelopmentMatchStore` conserva un solo `DateTimeOffset` per ciascun `actorId`, non per browser/token/tab. Il registry non supera il numero di partecipanti (2–8), anche con centinaia di heartbeat simultanei. Un seat è attivo se `now >= lastHeartbeat` e `now - lastHeartbeat < 15 secondi`: al quindicesimo secondo esatto è inattivo. `TimeProvider` iniettabile rende la finestra temporale deterministica nei test.

Né GET né POST invocano comandi Domain o incrementano `Match.Revision`, scrivono eventi audit, notificano subscriber long poll o salvano checkpoint AES-256-GCM. Il restore da file recupera partita/mani/token ma **non** il registry presenza: all'avvio i posti sono inattivi fino al primo POST. Dopo rotazione riuscita della capability, il vecchio bearer ottiene 404 e l'attore ruotato viene rimosso dal registry; gli altri posti non cambiano. Un errore I/O durante la rotazione mantiene valido il vecchio bearer e non azzera la presenza.

I timestamp restano esclusivamente lato server; la risposta offre solo booleani. Più tab per un posto si aggregano in una sola presenza e un browser chiuso può apparire attivo per il tempo residuo. Inattivo ≠ disconnesso e attivo ≠ utente umano connesso. Non esiste TTL della partita, né disconnessione automatica o timeout di turno.

## UI React

Il laboratorio Development invia un heartbeat al join/create e circa ogni cinque secondi, **solo** quando `document.visibilityState !== "hidden"` e `navigator.onLine`. Un request in-flight blocca le invocazioni concorrenti; ogni richiesta usa `AbortController`, abortisce quando cambia match/token/attore e quando la tab si nasconde o il browser passa offline. Al rientro in foreground/online riprova. Lo stato viene accettato solo se `matchId`, bearer e posto coincidono con la scope corrente e se contiene esattamente tutti i playerId canonici, senza duplicati, con booleani validi.

L'UI del roster usa le stringhe localizzate “attivo di recente”, “non attivo di recente” e “stato non disponibile”. In assenza di risposta attendibile, rimane unknown anziché inventare uno stato. Un 503/error offline non revoca la sessione, non svuota la mano e non modifica le mosse; un 404 del token corrente segue invece la riconciliazione di revoca (#31). La presenza non viene scritta nel browser storage né nella scena 3D o nei comandi.

## Matrice dei test

xUnit: lettura non segnala presenza; heartbeat agisce solo sull'attore autenticato; scadenza esatta 15s con orologio manuale; 8 posti e 512 chiamate concorrenti; token sconosciuto e rotazione; revisione/turni/audit immutati; nessun falso wake-up long polling; nessuna scrittura del checkpoint cifrato, reset su restart, rollback I/O di rotazione; WebApplicationFactory 200/404/no-store, spoofing di playerId e Production 404.

Playwright mocked: roster mobile/EN, due posti, cambio attore, token in memoria, 503/malformed response -> unknown e nessuna revoca/comando inventato, risposta tardiva vecchio attore non sovrascrive quello nuovo.

Playwright live: browser Alice create, browser Bob join, i due heartbeat compaiono nella proiezione del vero server .NET 10, la revisione non cambia, la rotazione revoca il token vecchio e non tocca il posto dell'altro; né token né dati privati finiscono nel JSON o nello storage del browser.

Fuori scope: account reali, connessione WebSocket/SignalR, identificazione dei singoli dispositivi, persistence/pubsub tra processi, gameplay di #4/#6. Tracciamento: [issue #38](https://github.com/KeyserDSoze/Game.Edonism/issues/38), [ledger](development-ledger.md). La issue va chiusa esclusivamente dopo la CI completa sul commit HEAD di `main`.
