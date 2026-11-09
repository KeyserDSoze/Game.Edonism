# Match engine — sorteggio dei 23 personaggi (issue #17)

**Fonte autorevole:** regolamento italiano stampato `rulebook2.zip`. A **p. 3** sono elencate **23 carte personaggio** e 40 cuori (5 per colore). A **p. 4** è prescritto di mescolare i personaggi, farne pescare uno per giocatore, mostrarlo pubblicamente, usare il valore di vita stampato in alto a sinistra e inserire obbligatoriamente l'attività associata nel tabellone.

## Componenti di dominio

- `CharacterCardDefinition(Id, StartingActivityCardId, PrintedInitialHearts)`: schema per importare le carte reali, **non** un catalogo già importato. Valida 23 ID distinti, tutte le associazioni presenti nel catalogo di 46 attività tipizzate e un numero di cuori da 1 a 5 compatibile con i segnalini stampati. Il dominio **non inventa** nomi, vite o corrispondenze.
- `CharacterSetupComposer.Draw`: parte dai 23 dati tipizzati, li ordina per ID, applica il Fisher–Yates con PRNG `xorshift32` e assegna **un personaggio distinto a ogni giocatore** nell'ordine dei partecipanti al fixture. Versione algoritmo `character-draw-v1-xorshift32`; il seed è una scelta tecnica di riproducibilità, non una regola nuova del gioco.
- `GameMatch.CreateFromTrustedCharacterCatalog`: compone la distribuzione 46→30 dell'issue #16 con **stream di seed separati** (per il setup attività `seed XOR 0x9E3779B9`), trova lo slot della carta obbligatoria del personaggio, ricava strada e scagnozzo iniziale e registra le **vite stampate** nella vista pubblica `Players[].Hearts` e `AssignedCharacters[]`.
- I vecchi fixture `CreateFromTrustedSetup` e `CreateFromTrustedCardSetup` non hanno un personaggio pescato e mostrano `Hearts = null` e `AssignedCharacters = []`, evitando falsi attributi di gioco.
- Il Domain è indipendente da ASP.NET, dal renderer e dalle carte di fazione. La UI 3D resta un'anteprima e non interpreta punti vita o regole delle carte.

## Ambiguità gestite senza inventare una nuova regola

Il regolamento prescrive la **conservazione** delle attività iniziali dei personaggi. Se due personaggi estratti richiedono lo stesso ID di attività fisica, o la somma delle obbligatorie di una categoria supera la quota (cfr. **#4/R-03**), la creazione del match viene **rifiutata** senza cambiare lo stato. Non introduciamo rilanci automatici, copie di carte, compensazioni, scambi di personaggi o una nuova procedura di gioco non approvata.

La procedura non assegna fazioni, poteri, azioni, mazzi, carte segrete, tasse, una struttura di vittoria o nuove fasi. L'input di prova comprende soltanto i dati pubblici stampati dei personaggi.

## API locale di sviluppo

`POST /api/dev/matches/from-characters` accetta un corpo con questa forma:

```json
{
  "playerIds": ["alice", "bob"],
  "characters": [
    { "id": "synthetic-character:01", "startingActivityCardId": "sport:01", "printedInitialHearts": 3 }
  ],
  "availableActivities": [
    { "id": "sport:01", "category": "sport" }
  ],
  "seed": 2026
}
```

**Esempio di struttura, non richiesta valida completa:** devono essere presenti **23 personaggi** e **46 attività** univoci. Questi nomi/valori sono **fittizi**, usati unicamente nelle fixture di test; non sono dati canonici del gioco.

La risposta include la normale coppia `matchId`/snapshot e le credenziali effimere dei posti, come gli altri endpoint Dev. Lo snapshot mostra `assignedCharacters` con `playerId`, `characterId`, `startingActivityCardId`, `printedInitialHearts`, le `boardActivities` e il campo `hearts` per i giocatori. Il client non può selezionare direttamente il personaggio né una posizione arbitraria in questo percorso. I comandi movimento e fine turno continuano ad essere validati con token e `ExpectedRevision`.

**Sicurezza:** la route e il suo store in memoria esistono **solo** con `ASPNETCORE_ENVIRONMENT=Development`. Il creatore del fixture riceve tutti i token; non deve essere esposto a Internet. L'identità multiplayer e lo storage persistente di Production rimangono alla #13.

## Copertura e continuità

Test xUnit: catalogo/controllo delle 23 carte, corrispondenza carta→attività, valori vita, riproducibilità del sorteggio, duplicati e overquota impossibili, avvio partita, posizione e proprietà, compatibilità fixture precedenti, immutabilità, API dev/prod e lettura solo con token. Playwright continua a coprire la scena React 3D come regressione.

**Bloccanti per partite vere:** approvazione delle ambiguità **#4/R-03 e R-10**, importazione dei **23 personaggi originali** e delle 46 carte attività in #7/#9, sicurezza #13; #6 rimane aperta per fasi, azioni, salario effettivo ed elezioni. Non dichiarare il gioco completo.

## Risultato CI

[Workflow `main` #42678161809](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/42678161809), commit `8298dbcd`: **109/109 xUnit**, **5/5 Playwright**, build .NET/TypeScript riuscite, 0 warning/errori .NET. Le prove API verificano che la route `from-characters` non esista in Production e che la vista della partita in Development sia accessibile solo con token.
