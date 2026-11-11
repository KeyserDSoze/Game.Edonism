# Edonism — stato del turno live nel laboratorio PvP (#41)

## Contratto Development

Il client React deve mostrare una segnalazione *informativa*, derivata soltanto dallo snapshot pubblico della partita autenticata, `phase` e `activePlayerId`, e dal posto attualmente selezionato tramite token valido. Tre stati:

- `mine`: `phase === PlayerTurns` e il server dichiara attivo il posto selezionato;
- `other`: un altro attore è attivo;
- `pending`: la partita è in `AwaitingRoundSettlement`. Nessuna azione automatica di paga, pesca o elezione.

Il DOM espone `data-testid="dev-turn-signal"`, `data-turn-state`, `role="status"`, `aria-live="polite"` e `aria-atomic="true"`. Testo italiano e inglese dal catalogo i18next, con layout responsive e senza dipendenza da WebGL.

L'HTML `<title>` conserva il titolo iniziale `Edonism — City Preview`; durante **solo il proprio turno** riceve un prefisso localizzato. Non include mai nome giocatore, ID partita, bearer, UUID, carte o stato privato. React lo ripristina sul cambio posto, fine turno, uscita, revoca o unmount; il titolo segue anche la lingua corrente. Lo stato dell'avversario viene aggiornato con il polling autenticato già presente (#30/#34), senza timer o richieste aggiuntive.

## Privacy e limiti

Non è un permesso Domain: le azioni `free-move` e `end-turn` sono autorizzate soltanto dal server con le sue `turn-options`, revisione e idempotenza (#29/#35). Non utilizzare presence (#38), la cronologia selezionata (#37) né coordinate 3D per dedurre il turno; non assegnare timeout, vittoria o azioni automatiche. Non chiedere permessi browser per notifiche push/OS; non salvare nulla nel browser. Il laboratorio è solo Development (#13 per auth Production); il modello realtime/async rimane in discussione in #4/R-16.

## Accettazione

Playwright mocked verifica gli stati in italiano, il prefisso dopo join/cambio posto, i turni in sequenza, la fase pending e la pulizia al leave; test EN mobile include revoca e controllo storage. Playwright full-stack verifica la propagazione Alice→Bob tra due browser reali via API .NET, i titoli nelle due lingue, la fase pending e il browser che lascia. La CI esegue anche tutti gli xUnit sul Domain e sugli endpoint; la issue #41 si chiude solo con il gate HEAD di main verde.
