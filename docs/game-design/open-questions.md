# Edonism — discrepanze e decisioni aperte

Le domande che seguono **non** sono bug del gioco: identificano differenze fra la stampa e fonti più vecchie, o dettagli non ricavabili con sicurezza dalle immagini. La stampa resta la fonte principale finché il game designer non approva una variazione.

| ID | Tema | Stampa `rulebook2.zip` | Documentazione precedente | Rischio e domanda |
| --- | --- | --- | --- | --- |
| R-01 | Geometria della città | Plancia ortogonale con 30 attività collocate lungo strade nominate [pp. 4, 7–8]. | Foundation demo R3F = griglia esagonale. | **Decisione fondamentale:** mantenere i 30 slot e il grafo di strade della stampa, rappresentandoli in 3D con padiglioni/esagoni decorativi, oppure riprogettare davvero il movimento per esagoni? In assenza di risposta, **non cambiare regole movimento**. |
| R-02 | Componenti | 58 azioni + 1 elezione, 46 attività, 23 personaggi, 11 fazioni, 8 grandi opere [p. 3]. | `document.pdf`: 65 azioni, 41 attività, 20 personaggi, 8 fazioni e 17 quest. | Versioni diverse. Per la futura acquisizione dati usare conteggi della stampa; richiedere asset carta singoli e verifica deck. |
| R-03 | Setup | 4 atoms per giocatore; 30 attività (5 pubblici, 5 privati, 4 mercato nero, 4 corruzione, 4 cultura, 2 sport, 3 trasporti, 3 vescovato) [p. 4]. | `document.pdf`: 2 atoms, categorie/numeri diversi, quest segrete. | Non mescolare. Chiarire come compensare eccedenze di attività iniziali di una categoria nei casi estremi. |
| R-04 | Vittoria | Due modalità a fazioni; Bifaccia solo con 8 proprietà o eliminazione degli altri salvo capi [p. 21]. | `document.pdf`: vittoria anche da quest personale. | **Non implementare quest** salvo futura modifica al regolamento. |
| R-05 | Build/Wreck | Stick da **3 atoms**, con effetti distruzione/sostituzione attività [pp. 14–15]. | `document.pdf`: stick da **2 atoms**, Wreck rende l'attività libera. | Implementazione solo secondo stampa. |
| R-06 | Tasse | Sindaco imposta tasse sul salario **0–2 atoms**, costruisce grandi opere [p. 10]. | `document.pdf`: contributi sociali/commissioni trasferimento e servizio. | Non importare commissioni obsolete come default. |
| R-07 | Mano carte | Primo stabilisce il numero di carte a fine turno; rifornimento quando **tutti a 0**; casseforti e reazioni [pp. 5–8]. | `document.pdf`: numero di carte giocate 1 o 2 comune a ogni giocatore, rifornimento alla fine round. | Serve flowchart approvato di calcolo esatto residui, istantanei, rifornimento e carta elezione. |
| R-08 | Salario | 2 base + 1 per attività controllata con scagnozzo in piedi [p. 5]. | `document.pdf`: 2 atoms base + eventuali poteri. | Confermare regime stipendio/tasse se l'attività è corrotta o atterrata. |
| R-09 | Elezioni | Pagine 5 e 9: carta Giorno elezione; esempio p. 17: **elezioni al primo turno anche senza carta**. | `document.pdf`: attivazione carta durante il rifornimento. | Formalizzare trigger primo turno e successive elezioni, ballottaggi, gestione carta. |
| R-10 | Topologia | Legenda strade p. 8; esempi adiacenze p. 7. | Nessuna tabella dati ufficiale. | Estrarre tutte le adiacenze e assegnare 30 `ActivitySlotId` prima di creare pathfinding/selection. |
| R-11 | Inventario grafico | Le immagini inviate sono screenshot di cartelle, non 46 file attività o 23 personaggi importabili uno a uno. | Nessun asset nel repository della foundation. | Chiedere o importare successivamente i file individuali, verificare diritti di pubblicazione prima di commit pubblico. |
| R-12 | Informazione nascosta | Fazione segreta, cassaforte, messaggi e voti segreti [pp. 4, 8–9, 17–20]. | La foundation ha solo demo locale. | Definire contratti server per viewer/attore, visibilità dopo corruzione/rivelazione, e test a due client. |
| R-13 | Determinismo | Pesca random di attività, personaggi, fazioni, elezioni; interventi degli avversari [pp. 4–6]. | Non sono specificati seed/protocolli. | Proposta digitale: RNG seed/versionato e audit eventi; approvare la semantica dei mazzi/reshuffle. |
| R-14 | Attività/edifici | Costo, categoria, potere @ e # sulle carte [pp. 4, 10, 12]. | Solo miniature di cartelle in conversazione. | Fare censimento delle carte con valori leggibili, doppioni e varianti, prima di costruire un JSON definitivo. |
| R-15 | Reazioni istantanee | Protect/Drink/Deny a triangolo; catene di contrapposizioni [p. 16]. | Versione inglese precedente differente. | Chi ha priorità in una finestra di reazione simultanea online? Come si determina timeout/pass e ordine server? |
| R-16 | Funzionalità async PvP | Regole parlano di gioco al tavolo, conversazioni private e turni presenziali. | Il nuovo prodotto è web PvP. | Determinare se le partite saranno sincrone realtime, a turni asincroni o entrambe; prima di decidere timeout, reconnection, disponibilità. |

## Priorità

**Blocchi di progettazione:** R-01 (mappa), R-07 (turno), R-09 (elezioni), R-15 (contrapposizioni in rete), R-16 (modalità PvP).  
**Acquisizione contenuti:** R-02, R-11, R-14.  
**Conferme numeriche:** R-03, R-08.  
I restanti aspetti possono essere sviluppati in parallelo dopo formalizzazione della base.

## Strategia per modifiche al regolamento

Ogni cambiamento rispetto alla stampa deve avere: issue motivata, `RuleSetVersion` con differenza testuale e consenso del game designer, test deterministici xUnit, adattamento API/UI ed eventuale migration procedure per match già iniziati. **Le correzioni editoriali non sono approvazioni di modifiche di gameplay.**
