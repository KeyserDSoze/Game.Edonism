# Player ID tecnico: protezione dell'audit e del setup PvP Development — #57

## Contesto e confini

La partita Development è un prototipo del core PvP first-round, con 2–8 posti autorizzati da bearer opachi. Il suo `PlayerId` è una **chiave tecnica** persistita in snapshot, eventi, mano privata, turn order, replay e checkpoint, non un nome account o un nickname arbitrario della futura Production (#13). Prima di #57 un ID solo non vuoto poteva contenere caratteri di controllo/invisibili o essere molto lungo. Il budget creator complessivo di 128 KiB non imponeva alcun vincolo alla singola chiave di identità.

## Regola di protocollo

Il file `src/backend/domains/Edonism.Domain/Matches/MatchParticipantId.cs` espone `MatchParticipantId.MaxLength=64` e `IsValid`. Si accettano ID non vuoti da 1 a 64 **unità UTF-16** (non grapheme count), inclusi normali caratteri Unicode stampabili e spazio ASCII all'interno. Si rifiutano ID composti da solo whitespace, con spazi ai margini, controlli (C0/C1/DEL), categoria Unicode `Format` (es. U+202E override bidi, U+2066 isolamento bidi, U+200B zero-width), separatori di riga/paragrafo U+2028/U+2029 e whitespace Unicode diverso dallo spazio ASCII ordinario. La stringa di attore valida è preservata **byte-per-byte come sequenza .NET di UTF-16 code units**, senza trim, case fold o sostituzioni.

**Non è una regola stampata di game design**: è una protezione del protocollo tecnico e delle etichette accessibili. L'eventuale display name degli account in Production potrà seguire un contratto UX distinto, senza mai confonderlo con l'identità bearer.

## Punti di controllo

- `GameMatch.CreateFromPreconfiguredSlots` valida il setup di slots del Domain; `GameMatch.CreateFromTrustedCardSetup` blocca gli ID prima della composizione.
- `CharacterSetupComposer.Draw` e `InitialActionDeckComposer.Deal` validano indipendentemente `playerIds`, coprendo sia Character/Full-Deck HTTP creator sia eventuali chiamanti Domain non HTTP.
- `MatchAuditReplay.Verify` rifiuta `PlayerId` invalidi in qualsiasi snapshot, pubblica `invalid_audit_setup` senza frames e blocca conseguentemente `GameMatch.RestoreFromCheckpoint`. I controlli non autorizzano nuovi eventi, carte o economie.
- I quattro endpoint Development esistenti restituiscono 400 con codici invalid_*_setup (non token, stato o deck). L'eventuale creator successivo può sempre inizializzare due posti; i read/command richiedono ancora solo il bearer del proprio seat e la revisione autoritativa. Nessun route Development esiste in Production.

## Copertura e regressioni

Test xUnit parametrizzati: ASCII/Unicode stampabile, limite esatto 64 e 65 unità UTF-16 (anche emoji a due code units), null/vuoto, spazi, tab, newline, DEL, bidi/zero-width, separatori Unicode; creazione valida da 2 a 8 posti, tutti e quattro i factory Domain e i due compositori, audit e checkpoint adulterati, attore valido 64 caratteri che riceve una mano e usa movimento/replay. Integration `WebApplicationFactory`: 12 richieste malformate per i quattro HTTP creator, errori no-store senza credenziali e un successivo setup autenticato, più bearer e movimento di un ID al limite. Playwright live invia payload invalidi all'API .NET reale e poi crea una partita full deck valida in React; suite UI mocked preesistente e suite xUnit restano obbligatorie.

[Issue #57](https://github.com/KeyserDSo/Game.Edonism/issues/57) è la fonte del tracking e del link alla CI conclusiva 3/3 sullo stesso HEAD finale di `main`.

Restano aperti il vero ciclo del secondo round/economia e le scelte del regolamento #4/#6, la sicurezza Production #13, i poteri #7/#8 e i dati originali #9/#19.

## Unicode scalar completo

Il controllo non deve iterare su `char` singoli assumendoli sempre scalari Unicode. La policy usa `Rune.DecodeFromUtf16` e rifiuta sequenze UTF-16 non well-formed (high/low surrogate isolati), perché un encoder JSON potrebbe sostituire l'unità malformata cambiando l'identità visibile al client. La categoria Unicode viene valutata su **ogni rune completa**, includendo i format code point supplementari come U+E0001 (LANGUAGE TAG): la loro coppia surrogate non deve aggirare il blocco `Format`. Un emoji valido costituito da due unità UTF-16 resta ammesso. I test Domain contengono surrogate isolati e un tag invisibile supplementare, Playwright live invia il tag supplementare valido all'API reale e verifica 400.
