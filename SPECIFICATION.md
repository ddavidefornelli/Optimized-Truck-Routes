# Optimized Truck Routes — Specification

**Versione:** 0.1 — proposta da approvare  
**Data:** 11 ottobre 2026  
**Stato:** progettazione; nessuna implementazione ancora realizzata.

## 1. Obiettivo

Realizzare una web app che proponga percorsi adatti ai camion in Finlandia. Il percorso consigliato non deve essere necessariamente il più breve: deve rispettare le restrizioni dei mezzi pesanti e bilanciare tempo, distanza e caratteristiche della strada.

Fattori richiesti:

- fondo asfaltato, sterrato o non documentato;
- larghezza della strada;
- traffico e interruzioni;
- attraversamento di zone urbane e centri cittadini;
- curve strette;
- condizioni potenzialmente critiche;
- illuminazione durante gli spostamenti al buio;
- eventuali curve cieche, solo dopo una verifica di fattibilità.

**“Ottimale” significa minimo costo rispetto al modello, alle preferenze e ai dati disponibili**, non garanzia del percorso più sicuro in assoluto. Il sistema deve spiegare le proprie scelte e rendere visibili dati mancanti, approssimazioni e informazioni obsolete. Non sostituisce segnaletica, norme vigenti o valutazione del conducente.

## 2. Decisioni architetturali proposte

| Componente | Scelta | Motivazione |
| --- | --- | --- |
| Frontend | Vite + SolidJS + TypeScript | Interfaccia reattiva leggera, adatta a mappa, filtri e confronto di percorsi. |
| Stili | Tailwind CSS, integrazione Vite | Sviluppo rapido e componenti coerenti, senza un framework UI pesante. |
| Mappa | MapLibre GL JS | Visualizzazione di percorsi GeoJSON e layer geografici. |
| Backend | Python + FastAPI + Pydantic | API tipizzate, validazione degli input e accesso all'ecosistema geospaziale. |
| Elaborazione geografica | GeoPandas, Shapely, PyProj | Importazione, normalizzazione, misure metriche e associazione degli attributi stradali. |
| Persistenza | PostgreSQL + PostGIS | Geometrie, indici spaziali, dati normalizzati e provenienza delle informazioni. |
| Routing iniziale | NetworkX, dietro un'interfaccia dedicata | Prototipo verificabile su un'area limitata; non una promessa di prestazioni su tutta la Finlandia. |
| Tooling | npm per frontend; uv per Python | Gestione delle dipendenze e lockfile riproducibili. |
| Test | pytest, Vitest, Playwright | Algoritmi, API, componenti e flusso utente completo. |
| Ambiente locale | Docker Compose per database e servizi | Avvio riproducibile; frontend/backend utilizzabili anche fuori dai container. |

Preferiamo **SolidJS a VanillaJS**: le prestazioni percepite dipenderanno soprattutto da mappa, volume dei dati e routing; Solid semplifica la gestione dello stato senza introdurre il peso di un framework più ampio. Non serve SSR nell'MVP.

Il backend Python resta il punto d'ingresso anche se, dopo i benchmark, il routing nazionale dovesse richiedere un motore compilato o un servizio specializzato. Non introdurre inizialmente microservizi, Redis o una coda distribuita senza un bisogno misurato.

## 3. Ambito e priorità

### 3.1 MVP

- Area pilota proposta: Uusimaa, includendo una fascia esterna per non tagliare artificialmente i percorsi. Estensione finale subordinata a copertura dei dati e benchmark.
- Una partenza e una destinazione, inserite sulla mappa o tramite coordinate.
- Un solo profilo camion standard, predefinito e non modificabile dall'utente: altezza, larghezza, lunghezza, massa e, quando richiesto dai dati, carichi sugli assi/gruppi di assi. I valori devono essere concordati e documentati prima del routing reale; “standard” è una scelta del prodotto, non una certificazione universale.
- Rispetto di sensi unici, accessi, divieti di svolta e restrizioni dimensionali/peso supportate dai dati importati.
- Percorso **più breve ammissibile**, **bilanciato** e **a minori penalità stradali modellate**. Non chiamare quest'ultimo “il più sicuro”.
- Preferenze per strade che non hanno le seguenti condizioni (sterrato, strade strette, zone urbane, curve strette e tratti non illuminati)
- Traffico osservato, lavori, chiusure e restrizioni temporanee, nei tratti per cui l'associazione al grafo è sufficientemente affidabile.
- Confronto di distanza, durata stimata, caratteristiche stradali, qualità dei dati e motivi della raccomandazione.
- Modalità demo riproducibile con un piccolo grafo sintetico, chiaramente distinta dai dati reali.

L'MVP completo è il risultato delle milestone M1–M3: il primo prototipo sarà statico, il traffico arriverà successivamente, prima di considerare l'MVP concluso.

### 3.2 Evoluzioni

- Supporto a camion di dimensioni, masse e configurazioni degli assi diverse, con selezione/configurazione e validazione dei profili veicolo.
- Estensione nazionale dopo verifica di prestazioni e qualità.
- Ricerca indirizzi tramite un geocoder scelto e configurato esplicitamente.
- Meteo stradale, ghiaccio, neve e restrizioni stagionali aggiuntive.
- Indicatori storici di incidentalità, solo dopo validazione metodologica.
- Pendenze e analisi esplorativa della visibilità.
- Esportazione GPX e salvataggio dei profili.
- Partenza futura e modelli temporali di traffico, se supportati da dati adeguati.

### 3.3 Esclusioni iniziali

- Ottimizzazione di flotte, consegne multiple o Vehicle Routing Problem.
- Navigazione turn-by-turn, tracciamento continuo e ricalcolo automatico durante la guida.
- Trasporti eccezionali, merci pericolose e pianificazione di autorizzazioni speciali.
- Garanzia di transitabilità fisica di ogni curva o accesso a un deposito.
- Previsioni di traffico su strade prive di osservazioni o modello validato.
- Classificazione certa delle curve cieche.
- Account, pagamenti e app mobile nativa.

## 4. Dataset finlandesi

### 4.1 Fonti candidate e ruolo

| Fonte | Dati utili | Impiego | Limiti |
| --- | --- | --- | --- |
| Digiroad / Digitraffic Road Network — Fintraffic | Rete, sensi di marcia, classi stradali, velocità, pavimentazione, larghezza, illuminazione, restrizioni e svolte, secondo release. | Base principale per il grafo e attributi del camion. | Copertura e aggiornamento non uniformi; verificare schema e disponibilità di ogni attributo. |
| Digitraffic Road Traffic — Fintraffic | Stazioni TMS con velocità e volumi, messaggi di traffico, lavori, restrizioni temporanee e meteo stradale. | Aggiornamenti dinamici e stime di durata nei tratti coperti. | Le stazioni non descrivono il traffico su ogni strada; il map matching richiede direzione e contesto stradale. |
| National Land Survey of Finland / Maanmittauslaitos | Topographic Database, edifici e rete; modello altimetrico del terreno a 2 m. | Contesto urbano e analisi successive di pendenza/visibilità. | Un modello del terreno non descrive tutti gli ostacoli visivi né necessariamente la quota dell'impalcato di un ponte. |
| Statistics Finland | Incidenti con lesioni noti alla polizia, dotati di coordinate. | Ricerca su indicatori storici aggregati. | Dati incompleti rispetto a tutti gli incidenti; ritardo di pubblicazione; il numero grezzo non misura il rischio. |

Le fonti sopra sono candidate documentate, **non dataset già scaricati o verificati sul campo**. La prima attività tecnica sarà un audit su un campione reale: attributi, unità, percentuali di copertura, date, connettività e disponibilità dei download.

### 4.2 Attenzione: transizione Digiroad

Alla data di questa specification, Fintraffic dichiara che il precedente servizio Digiroad è terminato il **30 settembre 2026** e che il nuovo Digitraffic Road Network sarà introdotto gradualmente nel **2027** [1][2]. L'esistenza di download storici non implica aggiornamenti continui o compatibilità futura dello schema.

Conseguenze progettuali:

1. Partire da una release effettivamente scaricabile, versionata e accompagnata dalla sua documentazione; non utilizzare `latest` come dipendenza implicita.
2. Salvare versione, checksum, URL di origine e date di validità/acquisizione.
3. Separare gli adapter delle fonti dal modello interno, per supportare il nuovo schema senza riscrivere il routing.
4. Evidenziare nell'interfaccia l'età della rete, soprattutto per restrizioni dei camion.
5. Se il dato minimo non è disponibile, limitarsi alla demo o bloccare la modalità reale: non sostituire silenziosamente una rete completa con una priva di restrizioni.

La Topographic Database può contribuire alla geometria, ma **non va considerata automaticamente equivalente a Digiroad per restrizioni e attributi truck-specific**.

### 4.3 Licenze e accesso

- Digiroad: Fintraffic indica CC BY 4.0 [2].
- Digitraffic: dati aperti, gratuiti, soggetti ai termini collegati dal servizio [3]. Verificare i termini di ogni prodotto importato.
- NLS: i dati aperti sono CC BY 4.0; attribuzione con ente, dataset e data di consegna [6]. Alcune interfacce richiedono una API key; verificare condizioni di accesso e canale di distribuzione scelto.
- Statistics Finland: termini generali CC BY 4.0, salvo condizioni specifiche del prodotto [8].

Conservare le attribuzioni nel catalogo dei dataset e mostrarle nella UI. Le licenze della basemap e dell'eventuale geocoder sono separate da quelle dei dati di routing. Non assumere che un server pubblico di tile sia utilizzabile senza limiti in produzione; provider della mappa configurabile, con attribuzione obbligatoria.

## 5. Fattibilità delle caratteristiche stradali

| Criterio | Implementazione proposta | Attendibilità e fase |
| --- | --- | --- |
| Asfaltato / sterrato | Normalizzare le categorie di pavimentazione della release. | MVP. La semantica dell'assenza di un record deve essere verificata: in alcuni layer indica fondo non pavimentato, ma non consente di ignorare problemi di copertura/importazione. |
| Strade strette | Usare la larghezza rilevata come penalità di comfort; applicare separatamente il limite legale di larghezza. | MVP, quando disponibile. Larghezza della carreggiata, corsia e massimo autorizzato non sono lo stesso dato. |
| Traffico | Associare misure direzionali e messaggi al grafo, con TTL e confidenza. | MVP finale, solo dove coperto. Nessuna estrapolazione nazionale non validata. |
| Centro città | Combinare eventuali poligoni pertinenti e classe stradale; in loro assenza usare una proxy di area urbana esplicitamente etichettata. | MVP per la proxy; identificazione del vero centro subordinata a dataset adeguati. Una strada urbana non è necessariamente in centro. |
| Curve strette | Derivare una curvatura approssimata da geometria metrica, filtrata e campionata in modo uniforme; considerare anche le svolte agli incroci. | MVP come penalità, non certificazione di manovrabilità del camion. |
| Strade pericolose | Segnalare eventi documentati, condizioni e restrizioni; in futuro valutare indicatori storici normalizzati per esposizione al traffico. | Eventi disponibili nell'MVP; rischio storico fuori dal core. Non usare conteggio incidenti come “punteggio di sicurezza”. |
| Illuminazione | Layer di strada illuminata, con copertura esplicita; penalità condizionata al buio astronomico locale. | MVP dove disponibile. Presenza di lampioni non garantisce che siano accesi o funzionanti. |
| Curve cieche | Ricerca sulla distanza di visibilità con geometria 3D, terreno e ostacoli. | Sperimentale, escluso dall'MVP. Curvatura elevata non equivale a curva cieca. |

Per le **curve cieche**, un DEM del terreno può aiutare a trovare possibili occlusioni topografiche, ma da solo non basta: vegetazione, edifici, quota stradale, posizione/altezza del conducente e risoluzione dei dati influenzano il risultato. Eventuali risultati saranno indicati come “visibilità potenzialmente ridotta”, mai come rilevazioni certe senza validazione.

Per l'illuminazione usare coordinate, data e orario stimato del passaggio, con un calcolo astronomico che gestisca anche giorno/notte polare. Nell'MVP la partenza è immediata; l'orario di passaggio deriva da una prima stima della durata e l'approssimazione va dichiarata.

## 6. Modello di routing

### 6.1 Profilo veicolo e vincoli rigidi

Nell'MVP il backend risolve un unico profilo standard da una configurazione centralizzata e versionata. Non sono previsti selettori o input utente per dimensioni e peso. Il motore riceve comunque un oggetto `VehicleProfile` esplicito, separato dalle preferenze di percorso: nessuna dimensione o massa hardcoded nell'algoritmo, negli adapter o nel frontend. Le restrizioni si valutano rispetto a questo oggetto anche quando esiste un solo profilo.

Il modello interno conserva dimensioni, masse e dati degli assi con unità e semantica esplicite, senza introdurre nell'MVP un catalogo o la gestione di profili personalizzati. In seguito l'API potrà risolvere profili diversi o validare parametri personalizzati, mantenendo invariata l'interfaccia del motore. Ogni risultato riporta ID, versione e parametri del profilo effettivamente usato; eventuali cache devono includerne l'identità/versione nella chiave.

Prima di minimizzare il costo, eliminare archi e transizioni incompatibili con:

- sensi di marcia, divieti di accesso e svolta;
- limiti dimensionali applicabili;
- limiti di massa/carico sugli assi applicabili al profilo;
- chiusure e restrizioni temporanee valide e associate con affidabilità;
- opzione esplicita “escludi sterrato”, ove il dato sia noto.

Distinguere massa effettiva, massa massima autorizzata e carichi sugli assi quando la semantica della restrizione lo richiede. Non inventare valori del camion mancanti né usare limiti generici come prova di autorizzazione.

Se un requisito non è verificabile, riportare **compatibilità non verificata**. Un profilo prudente può escludere tratti con informazioni essenziali sconosciute, accettando che non sia trovato un percorso. Un percorso che attraversa dati incompleti non va presentato come certificato per il veicolo.

### 6.2 Grafo stradale

- Grafo diretto con archi paralleli, geometria, identificativi della fonte e attributi omogenei.
- Tagliare i link dove cambia un attributo rilevante e preservare il senso di applicazione.
- Associare gli attributi tramite identificativi e riferimenti lineari della release; non usare la sola vicinanza spaziale quando esiste una relazione ufficiale.
- Non creare connessioni fra strade che si incrociano a livelli diversi: ponti e tunnel non sono incroci a raso.
- Modellare divieti e costi di svolta con stato dell'arco entrante o grafo delle transizioni. Il solo shortest path su nodi stradali non è sufficiente.
- Snappare partenza/destinazione a un arco accessibile al veicolo, entro un raggio massimo configurato; inserire nodi virtuali per rispettare sensi e distanze dei tratti parziali.
- Mostrare punto selezionato, punto di aggancio e distanza fra i due. Non inferire che l'accesso finale a un deposito sia transitabile.

Conservare i dati geometrici in **EPSG:3067** per misure in metri; API e GeoJSON in **EPSG:4326**, ordine `[longitudine, latitudine]`.

### 6.3 Funzione di costo

Costo generalizzato, con componenti non negative e unità coerenti:

```text
C(P) = somma sugli archi e [
    w_time * estimated_seconds(e)
  + w_distance * distance_m(e) / reference_speed_m_per_s
  + distance_m(e) * (
        k_surface * surface_severity(e)
      + k_width   * narrowness_severity(e, vehicle)
      + k_urban   * urban_severity(e)
      + k_curve   * curve_severity(e)
      + k_dark    * unlit_in_darkness_severity(e)
      + k_unknown * uncertainty_severity(e)
    )
] + somma sulle transizioni [turn_penalty_seconds]
```

- `w_*` sono adimensionali, `k_*` hanno unità secondi/metro; le severità sono normalizzate nell'intervallo `[0, 1]`.
- Valori sconosciuti restano distinti da severità zero; la loro gestione segue il profilo di prudenza.
- Integrare il traffico nella durata stimata, evitando una seconda penalità sullo stesso ritardo.
- Applicare le penalità per lunghezza o per evento reale, non per numero di segmenti: suddividere un link non deve cambiare arbitrariamente la preferenza.
- Esporre contributi e pesi in una configurazione versionata. I valori iniziali sono ipotesi da calibrare, non soglie di sicurezza certificate.

Il percorso più breve ammissibile usa la distanza come obiettivo; gli altri profili utilizzano pesi predefiniti differenti. La UI consente preferenze comprensibili, non richiede all'utente di impostare coefficienti matematici.

### 6.4 Algoritmo, alternative e tempo

1. Iniziare con Dijkstra sul grafo di stato corretto: costo non negativo, comportamento deterministico e testabile.
2. Calcolare i profili sulla stessa versione della rete e sullo stesso snapshot degli aggiornamenti.
3. Deduplicare percorsi equivalenti; non promettere tre alternative se i profili producono la stessa soluzione.
4. Introdurre A* o un motore più efficiente solo dopo benchmark, mantenendo euristiche ammissibili e gestione delle svolte.

Nell'MVP il traffico è uno **snapshot congelato per richiesta**, non una previsione sul traffico al momento futuro di attraversamento. La stima notturna usa un primo passaggio e, se necessario, un ricalcolo limitato, dichiarando che il risultato non è un ottimo globale time-dependent. Il routing temporale completo richiederebbe un modello dedicato e verifica delle sue proprietà.

In caso di assenza di percorso, non rilassare silenziosamente i vincoli: restituire un risultato esplicito. Distinguere “nessun percorso nel grafo disponibile” da “nessun percorso possibile in Finlandia”.

## 7. Pipeline dei dati

```text
Fonti → download versionato → staging → normalizzazione/QA
      → PostGIS → costruzione grafo → snapshot attivo → API
Digitraffic dinamico → refresh periodico → matching/QA → overlay con scadenza
```

### 7.1 Importazione statica

- Import offline tramite comando Python; mai scaricare la rete durante una richiesta di routing.
- GeoPackage preferito quando disponibile; supporto Shapefile se necessario per pacchetti regionali.
- Adapter per fonte/release con conversione esplicita di codici, unità e riferimenti lineari.
- Controlli di geometria, duplicati, direzioni, livelli stradali, intervalli degli attributi e connettività.
- Report sulla copertura di superficie, larghezza, illuminazione e restrizioni; assenza documentata distinta da mancata copertura.
- Costruzione e validazione di un nuovo snapshot prima dell'attivazione atomica; mantenere il precedente per rollback.

### 7.2 Aggiornamenti dinamici

- Processo separato per polling con cache, timeout, backoff e rispetto delle istruzioni/rate limit del provider.
- Associazione per riferimenti stradali quando disponibili; matching geografico direzionale come fallback controllato. Scartare associazioni ambigue, ad esempio fra carreggiate parallele.
- Date di osservazione, validità e acquisizione distinte; orari persistiti in UTC e visualizzati con `Europe/Helsinki`.
- TTL specifico per prodotto, configurabile; non chiamare “live” un'osservazione scaduta.
- Se il provider fallisce, usare il routing statico con avviso, oppure rifiutare la richiesta se l'utente esige dati dinamici freschi. Non ignorare tacitamente una chiusura già nota: gestirla secondo validità e politica di scadenza.
- Nessun polling verso i provider direttamente dal browser.

## 8. Modello dati minimo

| Entità | Campi principali |
| --- | --- |
| `dataset_release` | fonte, versione, checksum, URL, acquisizione, data/periodo del dato, licenza, attribuzione, report QA. |
| `road_node` | ID, geometria, livello topologico. |
| `road_edge` | ID interno e originale, origine/destinazione, direzione, geometria, lunghezza, classe, velocità, superficie, larghezza, illuminazione, proxy urbana e curvatura. |
| `road_restriction` | arco/transizione, tipo, valore/unità, veicoli applicabili, condizioni, periodo di validità e fonte. |
| `turn_rule` | arco entrante/uscente, divieto o costo, eventuali condizioni e provenienza. |
| `dynamic_observation` | tipo, archi associati, valore, osservazione/scadenza, confidenza del matching e fonte. |
| `graph_snapshot` | release incluse, versione del modello, area coperta, build e stato di attivazione. |

Per gli attributi rilevanti conservare stato `known / unknown / not_applicable`, fonte e data disponibile. Non ridurre illuminazione o qualità dei dati a booleani che confondono “no” con “non sappiamo”.

Le richieste di routing non vengono salvate per impostazione predefinita. Fixture di test piccole nel repository; dataset pesanti, file scaricati, credenziali e artefatti del grafo esclusi da Git.

## 9. API proposta

API REST sotto `/api/v1`, documentata tramite OpenAPI.

| Endpoint | Comportamento |
| --- | --- |
| `GET /health` | Verifica del processo, senza dipendere da provider esterni. |
| `GET /ready` | Prontezza di database/grafo; demo e modalità reale distinte. |
| `GET /api/v1/datasets` | Fonti, versioni, copertura, freschezza e attribuzioni. |
| `GET /api/v1/routing-profiles` | Profili, criteri e capacità effettivamente disponibili. |
| `POST /api/v1/routes` | Calcolo e confronto dei percorsi richiesti. |

Richiesta MVP: il profilo standard viene applicato dal backend, non fornito dal client. Il campo `vehicle` non è accettato nell'MVP (errore `422`, non ignorato silenziosamente); il supporto a profili alternativi sarà un'estensione esplicita del contratto API.

```json
{
  "origin": { "longitude": 24.9384, "latitude": 60.1699 },
  "destination": { "longitude": 25.6639, "latitude": 60.3929 },
  "profiles": ["shortest", "balanced", "road_comfort"],
  "preferences": {
    "unpaved": "avoid",
    "narrow_roads": "avoid",
    "urban_areas": "avoid",
    "tight_curves": "avoid",
    "unlit_at_night": "avoid",
    "unknown_critical_restrictions": "warn"
  }
}
```

I dettagli dei carichi sugli assi nel profilo standard sono necessari quando una restrizione li richiede; in loro assenza la verifica corrispondente è sconosciuta. La configurazione del profilo standard va validata con Pydantic, come gli enum, limiti e comportamenti dell'API. ID, versione, dimensioni e masse del profilo attivo sono esposti da `GET /api/v1/routing-profiles`, distinti dai profili di costo del percorso.

Risposta prevista:

- esito, ID richiesta, modalità `demo` o `real`;
- profilo veicolo effettivo: ID, versione, dimensioni, masse e dati degli assi disponibili;
- geometrie dei percorsi in GeoJSON;
- metri, secondi stimati, costo e contributi al costo;
- profili associati a ciascuna alternativa, anche quando deduplicati;
- punti di aggancio alla rete e relativi scostamenti;
- lunghezza/quota di sterrato, tratti stretti, urbani e non illuminati; categorie sconosciute separate;
- avvisi localizzabili, restrizioni verificate e verifiche non possibili;
- copertura degli attributi e del traffico, snapshot/release e timestamp del dato;
- spiegazione basata su differenze reali, ad esempio “2,4 km di sterrato in meno, con 6 minuti stimati in più”.

Input invalido: `422`; coordinate fuori copertura o troppo lontane dalla rete: errore di dominio esplicito; nessun percorso: esito `no_route` con ragioni disponibili; servizio non pronto: `503`. Non inventare la ragione esatta di un `no_route` se non è dimostrabile.

## 10. Frontend e UX

Schermata principale con mappa, pannello laterale e schede di confronto:

1. Selezione partenza/destinazione e visualizzazione della copertura.
2. Riepilogo non modificabile del camion standard, con dimensioni, masse, unità e limiti d'impiego visibili, ricavati dal backend. Form e selettore del veicolo sono rinviati alle evoluzioni.
3. Profilo consigliato e preferenze “consenti / evita / escludi” solo dove supportate.
4. Calcolo con indicatori di caricamento, cancellazione/invalidazione di richieste superate e gestione degli errori.
5. Percorsi distinguibili per colore e stile; selezione di un percorso e dettagli dei tratti critici.
6. Riepilogo dei compromessi e informazioni su fonti, aggiornamento e limiti.

Layout responsive; controlli accessibili da tastiera; informazioni essenziali anche fuori dalla mappa. Non usare solo il colore per comunicare una restrizione.

MapLibre carica solamente i percorsi e i layer richiesti dalla vista corrente, non l'intera rete nazionale. UI separata dal motore di routing. Il calcolo rimane interamente nel backend.

## 11. Requisiti non funzionali

- **Prestazioni:** obiettivo iniziale, da validare, risposta di routing entro 2 secondi al p95 su area pilota, grafo già caricato e 5 richieste concorrenti. Documentare hardware, numero di archi/stati e casi del benchmark; escludere import e avvio. Rivedere motore/area se l'obiettivo non è raggiunto.
- **Limiti:** timeout e budget di esplorazione/configurazione; non eseguire calcoli CPU-bound nell'event loop. Inizialmente executor dedicato e concorrenza limitata, con memoria misurata.
- **Riproducibilità:** lockfile, snapshot e pesi versionati; stessi input e snapshot producono lo stesso risultato.
- **Robustezza:** errori chiari e fallback dichiarati; servizi esterni non indispensabili per la demo.
- **Sicurezza:** segreti solo sul backend, CORS limitato, validazione di coordinate/dimensioni/enum e rate limit in produzione. Nessun URL arbitrario del client usato per download.
- **Privacy:** origine/destinazione non registrate nei log ordinari; nessun tracciamento GPS continuo. Definire retention prima di eventuali salvataggi.
- **Osservabilità:** log strutturati con ID richiesta, tempi di calcolo e versione grafo; metriche di errori, copertura e anzianità degli overlay.

## 12. Struttura prevista del repository

La seguente struttura è una proposta: non viene creata in questa fase.

```text
Optimized-Truck-Routes/
├── SPECIFICATION.md
├── README.md
├── frontend/
│   └── src/
│       ├── components/
│       ├── features/route-planner/
│       ├── lib/api/
│       └── map/
├── backend/
│   ├── pyproject.toml
│   ├── src/truck_routes/
│   │   ├── api/
│   │   ├── schemas/
│   │   ├── routing/
│   │   ├── datasets/adapters/
│   │   ├── ingestion/
│   │   └── storage/
│   └── tests/
│       └── fixtures/
├── docs/
│   ├── datasets.md
│   └── architecture.md
├── data/                       # ignorata da Git
├── compose.yaml
└── .env.example
```

Separare controller API, adapter dei dati e algoritmo. Il motore deve poter essere testato senza HTTP, database o rete; i provider devono poter essere sostituiti da fixture.

## 13. Piano di realizzazione e criteri di accettazione

### M0 — Approvazione e audit dei dati

- Confermare stack, area pilota, valori del profilo camion standard e priorità.
- Scaricare un campione/release disponibile e verificare attributi, unità, licenze, connettività e copertura.
- Stabilire quali criteri possono essere attivi e quali devono apparire come non disponibili.
- **Uscita:** report di fattibilità; decisione documentata su uso reale dei dati e gestione della transizione Digiroad.

### M1 — Base eseguibile e demo

- Scaffold Vite/Solid/Tailwind e FastAPI, configurazione ambiente, database e test di base.
- Mappa, selezione punti, riepilogo del camion standard, API e piccolo grafo sintetico deterministico.
- Almeno due percorsi che dimostrino il compromesso fra distanza e sterrato/larghezza.
- **Uscita:** demo avviabile senza credenziali dei dataset, chiaramente etichettata; frontend/backend collegati e documentati. La basemap può essere opzionale in ambiente offline.

### M2 — Routing statico con dati finlandesi

- Import versionato dell'area pilota, grafo con direzioni e svolte, vincoli camion e criteri documentati.
- Illuminazione notturna e geometria delle curve come indicatori approssimati.
- Riepilogo di copertura, avvisi e spiegazione dei percorsi.
- **Uscita:** confronto riproducibile su dati reali, nessuna violazione di restrizioni note, benchmark iniziale e limiti dichiarati.

### M3 — Aggiornamenti dinamici e MVP

- Integrazione Digitraffic con matching controllato, timestamp, cache, TTL e comportamento offline.
- Test end-to-end, controlli di accessibilità, benchmark e gestione del degrado.
- **Uscita:** MVP che distingue chiaramente traffico osservato, stimato e assente; chiusure e restrizioni temporanee correttamente applicate.

### M4 — Estensioni validate

- Profili per camion di dimensioni/pesi diversi, con UI e validazione dedicate, senza riscrivere il motore di routing.
- Nationwide routing, meteo/pendenze, eventuale incidentalità, geocoding ed esportazioni.
- Studio separato sulle curve cieche, con campione validato e risultati di accuratezza.
- Nessuna funzionalità sperimentale presentata come certezza di sicurezza.

### Test obbligatori

- Le richieste MVP usano sempre il profilo standard configurato; tentativi di inviare dimensioni/pesi alternativi sono rifiutati con `422`.
- UI e risposta API mostrano ID, versione e parametri del profilo standard realmente applicato.
- Test unitari del motore con profili veicolo differenti verificano che i vincoli dipendano dal profilo ricevuto, non da costanti MVP; questo non espone il supporto multi-veicolo nell'API MVP.
- Un ponte con limite di altezza o massa incompatibile viene escluso, anche se più corto.
- Sensi unici e svolte vietate vengono rispettati, compresi archi paralleli e punti di aggancio intermedi.
- Un sovrappasso non crea un incrocio fittizio.
- “Evita sterrato” può accettarlo con penalità; “escludi sterrato” non lo attraversa quando noto.
- Larghezza sconosciuta non equivale a strada larga; restrizione sconosciuta non equivale a transito certificato.
- Suddividere una geometria in più archi omogenei non altera costo e scelta, salvo eventi reali di svolta.
- Penalità di illuminazione diverse fra giorno e notte; casi di notte/giorno polare gestiti.
- Osservazioni di traffico direzionali, scadute, ambigue o mancanti non diventano traffico live inventato.
- Una chiusura attiva può eliminare un percorso; guasti del provider producono il comportamento dichiarato.
- Coordinate fuori copertura, nessun percorso, timeout e input invalidi producono risposte esplicite.
- Le metriche mostrate dalla UI coincidono con l'API e le spiegazioni sono ricavate dai dati.
- Test automatici e CI non dipendono da API esterne live; i test di integrazione reali sono separati.

## 14. Punti da confermare prima dello scaffold

1. SolidJS + TypeScript, anziché VanillaJS: proposta consigliata.
2. Uusimaa come area pilota, con estensione determinata dall'audit.
3. Valori del singolo camion standard MVP: dimensioni, masse e configurazione degli assi. Le altre classi di camion sono fuori dall'MVP.
4. Politica predefinita sui dati critici mancanti: avviso oppure esclusione prudente.
5. Provider/hosting della basemap e disponibilità di eventuali API key NLS.

In assenza di indicazioni diverse, procedere con SolidJS, area pilota e dati mancanti visibili tramite avvisi, senza dichiarare compatibilità certificata. Questa specification precede la creazione del progetto; lo scaffold è il passo successivo dopo approvazione.

## 15. Fonti consultate

Consultazione: 11 ottobre 2026. URL e condizioni possono cambiare; le release effettivamente importate avranno un catalogo separato e versionato.

1. [Fintraffic — Digitraffic Road Network e transizione del servizio](https://www.fintraffic.fi/fi/digitrafficroadnetwork).
2. [Fintraffic — uso, distribuzione e licenza del dataset Digiroad](https://www.fintraffic.fi/fi/digitaalisetpalvelut-4).
3. [Digitraffic — Service Overview e accesso ai dati](https://www.digitraffic.fi/en/service-overview/).
4. [Digitraffic — Road Traffic, TMS, meteo e messaggi di traffico](https://www.digitraffic.fi/en/road-traffic/).
5. [National Land Survey — Elevation model 2 m](https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/datasets-and-interfaces/product-descriptions/elevation-model-2-m).
6. [National Land Survey — licenza dei dati aperti](https://www.maanmittauslaitos.fi/en/opendata-licence-cc40).
7. [Statistics Finland — incidenti stradali geolocalizzati e limiti di copertura](https://stat.fi/en/services/statistical-data-services/geographic-data/road-traffic-accidents).
8. [Statistics Finland — termini d'uso](https://stat.fi/en/about-us/get-to-know-statistics-finland/legislation/terms-of-use).
9. [Digitraffic — Road and street network](https://www.digitraffic.fi/en/road-traffic/road-and-street-network/).
10. [Fintraffic — portale delle release della rete stradale](https://tie.digitraffic.fi/roadnetwork/#/).
