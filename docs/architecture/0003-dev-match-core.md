# ADR 0003 — Prima verticale del match engine (issue #12)

**Status:** accettata come infrastruttura di sviluppo per Edonism 0.0.2; **NON una partita PvP pubblica**.

## Decisioni
1. Il codice di dominio gestisce `Match` indipendentemente dall'API, con stato validato, ID giocatore, posizione su strade originali, turno corrente e `ExpectedRevision`. Le azioni del client sono intenzioni, mai posizioni/carte/risorse da fidarsi.
2. `CreateFromTrustedSetup` accetta *solo fixture interne al server*, con posizione iniziale risolta tramite uno `StartingSlotId` che esiste nel board. Non determina il personaggio, la fazione o le attività iniziali: i loro cataloghi arriveranno nelle issue #6 e #7.
3. Il movimento gratuito è permesso **una volta per turno** verso una sola strada adiacente (regolamento stampato, pp. 6–7); lo stato è auditato in `MatchAuditEvent` in memoria. I tentativi falliti non modificano la revisione.
4. Dopo l'ultimo giocatore la partita è `AwaitingRoundSettlement`: non avanziamo turni senza la fase stipendio/rifornimento/elezioni del regolamento. `RotateLastToFirst` è una funzione pura preparatoria, non completa il round.
5. La sola API mutativa disponibile in questa milestone è `/api/dev/matches/`. Viene registrata **solo quando `Environment.IsDevelopment()`**. Ogni fixture crea token crittograficamente casuali indipendenti per ciascun giocatore; il server deduce l'identità dal token per ogni comando. Stato e revisione vengono cambiati sotto lock per inibire race nello store in memoria.
6. Produzione: **nessuna** route di partita che accetti comandi e nessuna identità proveniente da request body. Login federato / identità verificata, persistenza, disconnessioni e privacy aspettano #13.

## Fonte/limiti
- `rulebook2.zip`: pp. 4–7 per strada iniziale/risorse di setup, movimento, turni, «Gli ultimi saranno i primi».
- `docs/game-design/board-topology-v1.md`: adiacenze, con cinque archi inferiti dall'immagine e ancora da confermare (#4).
- Le fixture Development assegnano al creatore **tutti i token**, perché sono uno strumento locale. Non avviare l'API Development su host accessibili da Internet.
- Non esistono ancora salvataggi, replay persistente, ownership, carte, tasse, combattimento, fazioni, poteri né turni aggiuntivi.
- Il frontend rimane un viewer 3D della plancia senza dipendenza dall'API.
- [Verifica CI #42662175729](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42662175729): 53 test xUnit, 5 Playwright, build verdi.

## Follow-up
#6 setup/round/azioni; #7 power cards; #8 fazioni; #13 sicurezza multiplayer, store, durability e audit; #4 conferma archi inferiti.
