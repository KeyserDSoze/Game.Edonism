# Rulebook — fonti e indice delle pagine

## Precedenza

Per questa acquisizione il game designer ha dichiarato che **`rulebook2.zip` è l'ultima revisione inviata in stampa**. Pertanto vale come riferimento testuale per la futura implementazione. La documentazione più vecchia non può correggerla automaticamente; ogni divergenza è un punto da discutere.

| Fonte fornita | Contenuto | Uso |
| --- | --- | --- |
| `rulebook2.zip` | `rulebook2/1.png` … `22.png` + cover/background JPEG; pagine italiane di cui 3–21 contengono regolamento | **Principale** |
| `poteri italiano.pdf` | 2 pagine, poteri attivi/passivi/istantanei | Riscontro su cap. 5 stampato, non sostituisce la fonte primaria |
| `document.pdf` | Regolamento inglese, 8 pagine, struttura e valori differenti | Riferimento **storico/obsoleto**, da non usare come default |
| `plancia di gioco.png` | Plancia con vie, municipio, piazza e spazi grigi attività | Riferimento visuale per topologia e slot |
| `image.png`, `image(1).png` … `image(4).png` | Screenshot di cartelle con miniature di attività, azioni, personaggi e carte speciali | Inventario preliminare, **non** fonte dati leggibile per tutti i costi/poteri |

## Indice di `rulebook2.zip`

| Pagina | Tema | Traccia implementativa |
| --- | --- | --- |
| 1 | Copertina | Identità visiva |
| 2 | Crediti e ambientazione | Lore, non regole |
| 3 | Obiettivo, componenti | Quantità mazzi/segna-stato |
| 4 | §1 Preparativi | Setup, attività per classe, assegnazioni personaggio/fazione |
| 5 | Fasi | Ordine completo del turno/round, salario, rifornimento, elezione |
| 6 | §2 Turno | Vincolo carte in mano, 10 operazioni |
| 7 | Movimento, azioni gratuite/pagate, acquisto attività/servizi | Vincoli di posizione e risorse |
| 8 | Pizzo, cassaforte, legenda strade, esempio | Restrizioni stati, recupero scagnozzi |
| 9 | §3 Sindaco, elezioni | Voti, ballottaggi, municipale, vita Sindaco |
| 10 | Tasse, 8 grandi opere | Tesoreria municipale, sblocco # |
| 11 | §4 Scambi | Beni scambiabili, minimi, trasferimenti, tariffe |
| 12 | §5 Poteri: tipologia e velocità | Cuore/lente/strada; attivo/passivo/istantaneo |
| 13 | Regola @/#; Heal, Inquire, Blackmail, Jail | Composizione poteri e target |
| 14 | Damage, Drug, Wreck, Steal, Corrupt, Discount, Innovate | Effetti, modificatori |
| 15 | Transfer, Draw, Stamp, Speed, Build, Protect | Passivi e reazioni |
| 16 | Spy, Drink, Deny, Vote, triangolo difese, poteri personaggio | Reazioni e timing |
| 17 | §6 Messaggi | Diplomazia privata, risposta, ID |
| 18 | §7 Corruzione: token, immunità, rimozione | Conversioni e denaro |
| 19 | Corruzione personaggio/attività/Bifaccia | Informazioni private e capacità |
| 20 | §8 Ulteriori regole | No danni nel primo turno, Pizzo, Bifaccia, rivelazione, riuso scagnozzi, cassa |
| 21 | §9 Fine gioco | Vittoria per fazione o Bifaccia, morte, salvataggio e uscita |
| 22 | Retro | Artwork |

## Dati visivi da trattare separatamente

- Le carte hanno nome, categoria/colore, costo dell'attività, poteri `@` e `#` e proprie icone. Prima di compilare un catalogo completo servono le **immagini singole originali** o file strutturati; gli screenshot delle cartelle mostrano solo un sottoinsieme leggibile.
- La plancia ha una geometria ortogonale con strade e proprietà collocate negli spazi grigi: le coordinate assiali `(q,r)` della demo R3F NON sono coordinate ufficiali di Edonism.
- L'archivio contiene alcune immagini di copertina/ambientazione il cui contenuto non costituisce una meccanica.

## Regola di tracciabilità

Ogni futuro elemento del Domain che implementa un comportamento deve indicare il riferimento a `rulebook2` (pagina e sezione), un ID di regola interno, una versione del regolamento e l'eventuale Issue che ha approvato una modifica rispetto alla stampa.
