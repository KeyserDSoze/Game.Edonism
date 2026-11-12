# Igiene della memoria del checkpoint cifrato Development — #62

## Confine

`DevelopmentMatchCheckpointFiles.Save` serializza il checkpoint *interno* della partita in un singolo `byte[]` UTF-8 tramite `JsonSerializer.SerializeToUtf8Bytes`. Include le mani private degli attori, il mazzo non pescato, i digest dei bearer e la cronologia del primo round: è un buffer **sensibile**. Il target persistito viene cifrato in AES-256-GCM con nonce fresco, AAD = matchId e tag a 16 byte prima di scrivere un file temporaneo nella directory privata, rinominato atomicamente a `{matchId:N}.edonism`.

Prima di #62 `CryptographicOperations.ZeroMemory(payload)` era soltanto nel `finally` del file temporaneo, quindi una `InvalidDataException` per JSON oltre 1 MiB o un errore nella cifratura prima della creazione del temp lasciava il buffer JSON in heap fino alla GC, non azzerato. Il `Load` già pulisce il plaintext decifrato nel suo `finally`.

## Invariante nuova

Immediatamente dopo `SerializeToUtf8Bytes`, tutto il percorso successivo è racchiuso in un **try/finally esterno** che cancella il buffer con `CryptographicOperations.ZeroMemory(payload)` **anche in caso di eccezione** da:
- guardia della dimensione massima (1 MiB di JSON in chiaro);
- RNG per nonce, cifratura AES-GCM, allocazione del ciphertext o dell'envelope;
- creazione/scrittura/flush del file temporaneo, impostazione dei permessi, rinomina atomica o pulizia del temp.

L'invariante di scrittura è indipendente: il `try/finally` **interno** continua a rimuovere il file `.tmp` cifrato se presente. Non cambia il formato `EDONDM01`, né la possibilità di leggere file di versione 1/2, il payload massimo, la cifratura, il nonce/AAD o la pubblicazione atomica di un comando. Non vengono scritti segreti nel messaggio di errore.

## Verifica e limiti

I test xUnit esistenti validano roundtrip di un match completo, ricostruzione di credenziali separate, mani non sovrapposte, fallimento di salvataggi I/O senza pubblicazione del comando e ripartenza da checkpoint AES-GCM legacy. La nuova regressione costruisce un **payload volutamente fittizio** con `BoardVersion` oltre 1 MiB (non una variante di regole valida), invoca `Save`, attende `InvalidDataException`, controlla che il vecchio ciphertext resti byte-identico e che non compaiano nuovi file `.edonism` o `.tmp`. Un nuovo store riapre lo stesso match e restituisce a ciascun bearer soltanto la sua mano di quattro carte. La suite xUnit include anche le fixture 2–8 posti già presenti; Playwright UI mocked e i 30 test live con vera API .NET restano nel gate CI per evitare regressioni di sessioni/private hands.

La cancellazione effettiva del `byte[]` è una proprietà strutturale del `finally` nel codice: **non è osservabile in modo affidabile da un test black-box .NET** una volta che l'oggetto diventa non raggiungibile. Non si sostiene di azzerare stringhe immutabili nel managed heap, tutti gli oggetti serializzati, dump di memoria, né di implementare Production authentication/database (#13).

[Issue #62](https://github.com/KeyserDSoze/Game.Edonism/issues/62) raccoglie checklist e report xUnit/UI/live, da concludere solo dopo tre job GitHub Actions verdi sullo stesso HEAD finale di `main`. Il gameplay bloccato da #4/#6 resta invariato.
