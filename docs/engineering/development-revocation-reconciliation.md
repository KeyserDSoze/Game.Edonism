# Reconciliating revoked Development seats — issue #31

## Motivo

La rotazione di #28 blocca immediatamente sul server le letture della mano privata, dell'audit, della partita e dei comandi dal vecchio bearer. Con il polling autenticato #30, il vecchio browser può però continuare a **mostrare una copia precedente della mano** e della partita se ignora un 404. Questa issue corregge il comportamento del laboratorio React; non cambia il Domain, il ciclo turni, le carte o la sicurezza Production.

## Contratto di revoca lato browser

Soltanto un **404 da un'API protetta per una sessione già stabilita** su `GET /{id}`, `GET /{id}/hand`, `GET /{id}/turn-options`, `POST /free-move`, `POST /end-turn` o `POST /rotate-token` invalida la credenziale locale. Questo è il significato usato dal prototipo Development; un 404 potrebbe anche indicare una partita rimossa o un checkpoint illeggibile. Non si promette recupero senza una credenziale ancora valida.

Prima di applicare la revoca il client confronta `matchId`, posto selezionato e **token esatto della richiesta** con lo scope corrente. Una risposta arrivata tardi da un posto precedente, oppure dal vecchio token dopo una rotazione riuscita, non può eliminare la nuova sessione. AbortController e confronti monotoni di revisione rimangono attivi.

La revoca comporta:
- mano privata locale e permessi di azione cancellati immediatamente; ETag associato al token vecchio azzerato
- in un join a posto singolo, nessuna sessione attiva, proiezione pubblica/3D ripulita, form di rejoin e feedback IT/EN
- nel creator multi-seat, rimozione **solo** della credenziale revocata e selezione del primo altro posto ancora posseduto, con sua mano ricaricata dal server
- nessuna mutazione del match autoritativo, della revisione o degli eventi; nessuna memorizzazione di token, mani o tag in Web Storage o URL

Un `409` di concorrenza comporta la normale riconciliazione della revisione #25; un `503` o errore di rete temporaneo **non** revoca il token, e i comandi restano validati in .NET. L'utente può riprovare quando la rete ritorna.

## Percorso di rejoin

Quando la vista del giocatore è stata chiusa per revoca, il titolare del nuovo bearer può condividerlo esplicitamente con l'utente in un canale adeguato al testing locale. L'utente inserisce `matchId` e nuovo token nel form Development. Il server risolve l'attore dalla sua credenziale, non da un campo `playerId` inserito a mano. Il browser torna a vedere solo la nuova mano del posto autorizzato. Il vecchio token rimane respinto da tutti gli endpoint, anche con un `If-None-Match` valido (non deve mai dare 304).

## Verifiche e limiti

I test coprono xUnit HTTP per token revocato su snapshot condizionale, mano, azioni e audit e continuazione dell'altro posto; Playwright mocked per rejoin, fallback multi-seat, errore 503 e 404 tardivo; Playwright live multi-browser per entrambi i lati della rotazione, la visibilità della mano e la continuità del primo round. Tutto eseguito nei tre gate GitHub Actions prima della chiusura di [#31](https://github.com/KeyserDSoze/Game.Edonism/issues/31).

**Limite importante:** nascondere un dato dal DOM dopo una revoca non elimina la conoscenza acquisita prima, né screenshot, estensioni o memoria fuori dall'app. Il prototipo Development non garantisce revoca retroattiva di dati già letti, autenticazione account, autorizzazione Production, DB multi-processo, controllo sessioni cross-device o recovery automatico: questi restano nel perimetro di [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13).
