# #155 — Validazione fail-closed dei giocatori quando i 30 lotti sono controllati

## Bug e rischio

La città PvP impiega la proiezione `verifiedPublicUncontrolledBoardActivities` (#149) per individuare i lotti pubblici liberi della plancia stampata, la matrice del controllo territoriale `verifiedPublicStreetControlMatrix` (#152) e il confronto per rivale `verifiedPublicTerritoryFootprints` (#153). L'API mantiene le regole e la titolarità dei partecipanti; le viste nel browser devono comunque rifiutare snapshot pubblici incoerenti.

L'elenco di lotti liberi `[]` era ambiguo: può indicare che tutti e **30** i lotti sono legittimamente controllati oppure che **l'intero snapshot pubblico è stato rifiutato**. Prima di #155, la matrice #152 usava `free.length + controlled.length === 30` e `playerMarkerPlacements`, che controlla duplicati, strade e ID non vuoti ma **non** la policy tecnica completa .NET (attore `system` riservato, Unicode invisibile, troppo lungo, spazi laterali, surrogate isolate). Uno snapshot falsificato con 30 controlli intestati a `system` poteva quindi produrre una matrice e un riepilogo PvP apparentemente verificati. Non è stato riscontrato accesso a mani private né la possibilità di comandare .NET con identità false: il difetto riguardava l'affidabilità della **rappresentazione pubblica**.

## Contratto dopo la correzione

- Il verificatore autonomo `verifiedPublicDevelopmentSeatRoster(snapshot)` restituisce un booleano, **non** un elenco di carte. Richiede un record, 2–8 posti, playerId univoci per confronto ordinale e validi secondo `isValidDevelopmentTechnicalPlayerId` (#127/#128) che ricalca la policy `MatchParticipantId.IsValid` .NET. Richiede inoltre che `activePlayerId` sia `null` (partita nel settlement) oppure corrisponda **esattamente** a uno dei posti. L'assenza del campo o un ID inventato falliscono chiusi.
- `verifiedPublicUncontrolledBoardActivities(snapshot)` (#149) convalida il roster prima delle 30 carte, dei lotti e delle categorie/quote (#140–#143), mantenendo la stessa interfaccia read-only. Una plancia lecita 30/30 restituisce **zero** lotti liberi, ma ora il successo del roster è un fatto **separatamente verificabile**.
- `verifiedPublicStreetControlMatrix(snapshot)` (#152) richiede **esplicitamente** il roster verificato prima di valutare `free.length===0`, i 30 controlli completi, proprietari reali, posture e ID degli slot. Una vera plancia completamente controllata resta ammessa; una plancia all-owned con ID illeciti non può diventare un territorio autentico.
- `verifiedPublicTerritoryFootprints(snapshot)` (#153) eredita il fail-closed dalla matrice: su snapshot falsificato restituisce `[]` senza proporre classifiche di vittoria, permessi d'attacco/acquisto o dati segreti.
- `system` è riservato **esattamente** con tale casing; `System` è un ID tecnico stampabile e valido, come nel Domain. Nessuna normalizzazione, trim o case-folding: l'identità del posto e i token restano esclusiva competenza del server.
- L'intervento non modifica il gameplay, la gestione dei token, le regole delle carte, l'audit o lo storage. Le schermate esistenti per partite 2–8 valide, round attivo e settlement restano operative.

## Regressioni

- **Playwright con vero modulo Vite 2/4/8**: parte da 30 carte e 30 controlli autenticamente pubblici con **0** liberi; altera **insieme** ID del primo posto, attore di turno e proprietario dei relativi lotti (falsificazione che i vecchi marker accettavano) usando `system`, spazi, control chars, bidi, zero-width, 65 code unit e surrogate isolate. Verifica esplicitamente tre distinti esiti (roster invalid, matrice vuota, footprint vuoto) e conserva `System` maiuscolo legittimo; rifiuta attore fantasma o mancante anche senza lotti liberi.
- **xUnit .NET 10 Domain 2/4/8**: il creator full-deck rifiuta gli stessi tipi di ID non sicuri in ciascuna dimensione della partita; un `System` valido mantiene la composizione autentica con 30 carte e audit verde, senza sostituire il controllo browser al server.
- **React Playwright e browser con vera API .NET**: restano le regressioni complete cumulative di #149–#153; nessuna nuova chiamata, autorizzazione o UI compare su roster non verificato. La suite live con API reali resta la verifica dell'origine server degli ID/slot su 2/8 giocatori.

Issue [#155](https://github.com/KeyserDSoze/Game.Edonism/issues/155); dipende da #149/#152/#153 e segue #6. Richiede **3/3 job GitHub Actions verdi sull'HEAD esatto di main** prima della chiusura. Nessuna estensione di #4/#7/#8 o login Production #13.
