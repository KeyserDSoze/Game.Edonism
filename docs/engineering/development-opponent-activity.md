# Segnalazione in-page delle attività pubbliche avversarie — #44

## Fonte autoritativa

Il laboratorio Development dispone di polling autenticato delle revisioni (#34), pubblico replay verificato del primo round (#37), stato del turno (#41) e progresso ordinato (#43). Questa funzionalità notifica **nel browser già aperto** le nuove azioni pubbliche degli avversari senza introdurre eventi, gameplay, timeout, meccaniche o API ridondanti.

La fonte **esclusiva** è la storia revision-aligned restituita da `GET /api/dev/matches/{id}/history`, con `MatchAuditReplay.Verify` nel Domain .NET. Il componente React la accetta solo con match + attore + bearer + revisione live concordi, eventi di tipo noto e dati dei giocatori coerenti. Ogni nuova join, cambio posto o rotazione di credenziale stabilisce come baseline **la revisione corrente del server**. Nessuna vecchia mossa del match appare automaticamente come nuova dopo una join tardiva. Per un dato viewer, soltanto frame con `revision > baseline`, `actorId != viewer` e tipo `free-move`, `turn-ended`, `round-settlement-pending` diventano non visti.

Il contatore è il totale degli eventi pubblici avversari nuovi; la lista mostra al massimo gli ultimi **cinque** in ordine revisionale con nome giocatore e tipo di evento. Una risposta della vecchia capability o revisione non può ripopolare il pannello. Se `/history` fallisce o è invalida, il pannello indica **verifica non disponibile**, senza inventare un conteggio.

## Conferma, privacy e limiti

Il pulsante `Segna come viste` (`Mark as seen`) aggiorna **soltanto** il cursore in memoria del componente alla revisione verificata. Non invia comandi HTTP, non scrive receipt, cambia revisione, wallet, mano, audit, posizione, presenza o permessi. Non persiste in URL, localStorage, sessionStorage o checkpoint. Il cambio di sessione/posto/token, la revoca e il leave azzerano il contesto locale. Accessibilità `role=status`, `aria-live=polite`, lista testabile e IT/EN; funziona anche senza WebGL.

Questa NON è una notifica di sistema, una promessa di push mentre il browser è chiuso, una prova di persona online o un trigger di timeout/skip. Login Production appartiene a #13, modalita' realtime/async e priorità reaction a #4.

## Test e gate

xUnit: frame replay immutabili, allineati alle revisioni per 2–8 attori, filtrabili per actor, nessun evento privato o mano, zero frame se manomessi, stato/checkpoint invariati. Playwright UI: comandi propri ignorati, movimento e fine turno avversario, conferma senza mutazioni, cambio posto e lingua, mobile, storia corrotta, join tardiva senza vecchi unread. Playwright live .NET: due browser Alice/Bob, passaggio turno e movimento, eventi verificati, ack locale e privacy Web Storage. La issue [#44](https://github.com/KeyserDSoze/Game.Edonism/issues/44) si chiude solo dopo tre job CI verdi sull'HEAD finale di main.
