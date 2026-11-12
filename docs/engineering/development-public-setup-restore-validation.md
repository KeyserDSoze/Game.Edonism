# Ripristino autoritativo delle categorie pubbliche e dei personaggi (#59)

## Vulnerabilità e confine

Il setup first-round Development è già definito: `ActivityPlacement.Assign` richiede 30 carte distribuite in otto categorie con quote esatte, e `CharacterSetupComposer.Draw` pesca una carta fisica unica per ogni posto, con 1–5 cuori stampati. Prima di #59, `GameMatch.RestoreFromCheckpoint` verificava le 30 carte e gli slot univoci ma **non** il conteggio delle categorie, né l'unicità degli `CharacterId`, né il limite superiore di 5 cuori; una partita senza personaggi poteva ritrovare cuori non-null inventati. Un file AES-GCM correttamente cifrato può avere comunque **dati non coerenti** con l'algoritmo Domain; il restore è un trust boundary.

## Convalide

`GameMatch.RestoreFromCheckpoint`:
- **0 attività:** fixture slot-only legacy senza board personalizzato; comportamento storico conservato.
- **30 attività:** tutti gli slot devono esistere sulla board canonica ed essere univoci, ogni `CardId` deve essere univoco; ogni `Category` deve esistere in `ActivityPlacement.PrintedCategoryQuotas`, con **esattamente** `public-financing:5`, `private-financing:5`, `black-market:4`, `corruption:4`, `culture:4`, `sport:2`, `transport:3`, `bishopric:3`.
- **Assegnazioni personaggio:** 0 per fixture legacy/card-only, con `Hearts == null` per tutti gli attori; oppure esattamente una per attore, `CharacterId` univoco ordinal, `PrintedInitialHearts` 1–5 e valori `Player.Hearts` corrispondenti. Le altre verifiche già presenti (card iniziale realmente collocata nello slot del giocatore, proprietario/henchmen, replay degli eventi, mano privata e shuffle) non vengono indebolite.

Qualsiasi mismatch lancia `InvalidDataException` **prima della costruzione del GameMatch** e non include ID delle mani private o bearer negli errori. Un nuovo `DevelopmentMatchStore` che tenta il reload da file AES-GCM cifrato ma logicamente alterato non restituisce né snapshot, né cronologia, né mano privata, mentre la vecchia istanza in RAM resta separata.

## Cosa non promette

La policy non prova che un determinato ID di carta sia nella categoria ufficiale né che sia il vero ID grafico: serve il catalogo originale completo della #19. Non modifica il compositore di setup, non inventa una deroga alla quota per mandatory card quando R-03 è ambiguo (#4), non accredita stipendio, non parte dal secondo round e non implementa autentica Production (#13). Verifica solo la **coerenza interna di regole già applicate dai composer** nel formato attuale del checkpoint.

## Test

- xUnit parametrizzato: quote/categorie sconosciute o spostate, 30 slot con ID duplicati/non canonici, personaggio fisico duplicato, cuori 0 e 6 (anche con cuore corrispondente nel player), mismatch cuore, assegnazione personaggio null, cuori inventati per fixture slot-only e card-only. Validità 2–8 posti con quote vere, e restore carattere/full-deck al termine del primo round.
- xUnit integration: file AES-GCM ricifrato con quote/categorie/character/hearts alterati; un nuovo store nega snapshot, private hand e replay. Test legacy/file v1/v2 e sicurezza bearer continuano nella suite completa.
- Playwright live: vera API .NET con quote delle otto categorie, slot/CardId univoci, 2 character ID diversi, cuori 1–5 coerenti; Playwright UI mocked regressione generale.

La [issue #59](https://github.com/KeyserDSoze/Game.Edonism/issues/59) conserva checklist e risultati finali. Chiudere solo dopo 3/3 job GitHub Actions success sullo stesso HEAD finale `main`.


## Risultato della prima CI

La [CI #43128535931](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/43128535931) ha verificato il commit funzionale [`acf978f`](https://github.com/KeyserDSoze/Game.Edonism/commit/acf978fe79a54c71347ecd5960e421d2bd49d7e6) con **401/401 xUnit (0 skip), 97/97 Playwright UI e 30/30 Playwright contro la vera API .NET: 528/528 test**, tutti e tre i job verdi. Questi test non sono una prova della mappatura canonica dei singoli ID di carta (#19), ma dimostrano la coerenza interna delle quote e dei metadati restituiti/ripristinati secondo il contratto v1. La verifica del commit finale di documentazione e la chiusura sono nella [issue #59](https://github.com/KeyserDSoze/Game.Edonism/issues/59).
