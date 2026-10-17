# Optimized Truck Routes — prima base Python

Prototipo iniziale di un navigatore/route planner per mezzi pesanti, costruito sulla [SPECIFICATION.md originale](https://github.com/ddavidefornelli/Optimized-Truck-Routes/blob/main/SPECIFICATION.md).

## Stato della prima versione

**Pronto:** API FastAPI e contratti Pydantic; grafo sintetico riproducibile; motore API NetworkX/Dijkstra con tre profili; schema iniziale Supabase/PostGIS; e ora un modello a oggetti in Python (`Nodo`, `NodoStradale`, `Strada`, `Curva`, `ProfiloCamion`, restrizioni e regole di svolta) con `RouterOggetti` e test dedicati.

**Non pronto:** dataset reale di Helsinki, pipeline che scarica/importa il network finlandese, collegamento del nuovo `RouterOggetti` agli endpoint HTTP e all'adattatore Supabase, feed di traffico live, frontend cartografico e rilevamento di curve cieche. Non ho importato dati reali e la modalità demo non è una mappa di Helsinki.

## 1. Avvio locale (modalità demo)

È richiesto Python 3.11 o superiore.

```bash
cd backend
python -m venv .venv
```

Attiva l'ambiente virtuale:

```bash
# Linux/macOS
source .venv/bin/activate

# Windows PowerShell
.venv\Scripts\Activate.ps1
```

Installa e avvia:

```bash
python -m pip install -e '.[dev]'
uvicorn truck_routes.main:app --reload
```

Apri `http://127.0.0.1:8000/docs` per provare le API Swagger. La demo non richiede chiavi o connessioni esterne.

### Esempio richiesta

```bash
curl -X POST http://127.0.0.1:8000/api/v1/routes \
  -H 'Content-Type: application/json' \
  -d '{
    "origin": {"longitude": 24.9384, "latitude": 60.1699},
    "destination": {"longitude": 24.9680, "latitude": 60.1900},
    "profiles": ["shortest", "balanced", "road_comfort"],
    "departure_at": "2026-06-15T12:00:00+03:00",
    "preferences": {
      "unpaved": "avoid",
      "narrow_roads": "avoid",
      "urban_areas": "avoid",
      "tight_curves": "avoid",
      "unlit_at_night": "avoid",
      "unknown_critical_restrictions": "warn"
    }
  }'
```

Coordinate incluse in questa richiesta corrispondono a nodi del **grafo di esempio**, non a un dataset reale. Per un test riproducibile, lascia gli stessi valori.

## 2. Endpoint disponibili

| Endpoint | Funzione |
|---|---|
| `GET /health` | Liveness del processo |
| `GET /ready` | Stato del grafo caricato e modalità demo/reale |
| `GET /api/v1/datasets` | Provenienza del dataset attivo o avviso demo sintetica |
| `GET /api/v1/routing-profiles` | Pesi correnti, capacità disponibili e profilo camion configurato |
| `POST /api/v1/routes` | Confronta i percorsi richiesti |

`POST /api/v1/routes` rifiuta campi extra come `vehicle`: nel contratto MVP il profilo veicolo viene scelto dal backend. La risposta identifica `recommended_route_id` (per default, la soluzione `balanced` se richiesta) e `recommended_profile`; le alternative rimangono consultabili. Se la coordinata è fuori dalla copertura caricata, restituisce `422`; se nessun percorso è presente nel grafo, la risposta riporta `status: "no_route"` e non allenta i vincoli in silenzio.

## 3. Come funziona il peso

Per ogni arco il motore combina durata stimata, distanza convertita in un'unità comparabile e penalità per fondo, larghezza, urbanità, curve, buio, dati sconosciuti ed eventi documentati. I coefficienti sono in `backend/src/truck_routes/assets/routing_weights.json` e riportano una versione. Cambiare i coefficienti permette di calibrare l'algoritmo senza modificare Dijkstra.

- `shortest`: minimizza la distanza, rispettando i vincoli rigidi e le preferenze impostate su `exclude`.
- `balanced`: combina tempo, distanza e penalità.
- `road_comfort`: dà un peso maggiore alle penalità stradali modellate.

“Preferisci evitare” aggiunge una penalità morbida; “escludi” rimuove un tratto quando la condizione è nota. Il valore sconosciuto non viene mai interpretato automaticamente come zero o come prova di transitabilità.

## 3.1 Nuovo modello a oggetti Python

Le classi richieste si trovano in `backend/src/truck_routes/domain/entities.py`:

- `Nodo`: i campi del camion (`id_nodo`, `tipo_camion`, `peso_camion` in kg, `nome_compagnia`, `strada_attuale`) e dimensioni opzionali.
- `NodoStradale`: il vertice topologico del grafo, separato dai dati del camion.
- `Strada`: ID, strade incidenti, origine/destinazione, lunghezza/larghezza, direzione, fondo, velocità, limiti di altezza/larghezza/lunghezza/massa, assi, traffico, illuminazione, urbanità, curve, pericoli e provenienza dei dati.
- `Curva`: raggio, angolo, segmenti coinvolti, severità e possibile esito di transitabilità.
- `ProfiloCamion`, `RestrizioneStradale` e `RegolaSvolta`: parametri del mezzo, vincoli e transizioni fra strade.

Il motore orientato agli oggetti (`truck_routes.routing.RouterOggetti`) applica Dijkstra mantenendo nello stato anche la strada entrante, così può rispettare i divieti di svolta e le penalità delle curve agli incroci. È per ora separato dal motore dell'API precedente. Per eseguire la demo sintetica:

```bash
cd backend
PYTHONPATH=src python examples/demo_classi.py
```

Per dettagli e limiti del modello, consulta [`docs/domain-model.md`](docs/domain-model.md).

## 4. Supabase / PostGIS

1. Crea un progetto Supabase e abilita PostGIS.
2. Esegui `supabase/migrations/001_initial_schema.sql` (verificando prima lo schema della tua installazione Supabase e la posizione dell'estensione PostGIS).
3. Copia `.env.example` in `backend/.env` e imposta `ROAD_DATA_MODE=supabase` e `SUPABASE_DB_URL` usando una stringa di connessione **solo server-side**.
4. Importa e valida un dataset versionato prima dell'avvio. L'adattatore carica un `graph_snapshot` in stato `active`; senza snapshot attivo, l'API segnala non pronta invece di inventare una rete stradale.

**L'adattatore Supabase non scarica e non importa ancora i dati stradali.** Lo schema da solo non popola strade. Il prossimo passo corretto è verificare un rilascio reale delle fonti finlandesi, auditare attributi/licenza/copertura, quindi implementare un importer che scriva staging, controlli QA e attivi uno snapshot in modo atomico. Per avviare questo audit su un file locale, installa le dipendenze `geo` ed esegui `python ../scripts/audit_road_dataset.py percorso/dataset.gpkg --output data-audit.json` dalla cartella `backend` (oppure indica `--layer` se il GeoPackage contiene più layer).

Non committare `.env`, credenziali, dataset massivi o artefatti del grafo. Mantieni URL della fonte, licenza, data di acquisizione, checksum e versione per ogni rilascio.

## 5. Configurazione

- `ROAD_DATA_MODE=demo` (default): usa un grafo sintetico; non richiede rete o credenziali.
- `ROAD_DATA_MODE=supabase`: tenta di caricare lo snapshot attivo dal database Supabase; se fallisce, `/health` rimane disponibile, mentre `/ready` e il routing riportano che il sistema non è pronto.
- `CORS_ORIGINS`: origini frontend autorizzate, separate da virgole.
- Profilo camion: `backend/src/truck_routes/assets/vehicle_profile.json`.
- Pesi: `backend/src/truck_routes/assets/routing_weights.json`.

I parametri del camion nel file attuale sono **segnaposto dimostrativi, non validati**. Prima di usare dati reali, sostituirli con valori approvati e documentati. L'API mostra sempre lo stato di validazione e, in modalità Supabase, blocca il routing finché il profilo non è marcato come validato.

## 6. Test

```bash
cd backend
python -m pip install -e '.[dev]'
pytest -q
```

I test non hanno bisogno di Supabase, traffico live o servizi esterni.

## 7. Roadmap tecnica consigliata

1. **Audit fonti finlandesi:** scaricare un campione ufficiale/licenziato; misurare copertura di larghezza, fondo, illuminazione, restrizioni e livelli ponte/tunnel.
2. **Importer versionato:** GeoPackage/Shapefile → staging → normalizzazione → QA → PostGIS → snapshot attivo; produrre report su copertura e connettività.
3. **Integrare il modello a oggetti:** creare un adattatore fra i nodi/archi Supabase e `NodoStradale`/`Strada`, poi collegare `RouterOggetti` all'API.
4. **Validare le restrizioni critiche:** semantica dei limiti, masse/carichi assi, stato delle chiusure, divieti e copertura dei dati reali.
5. **Traffico dinamico:** associazione direzionale, validità temporale, confidenza, scadenza e comportamento offline.
6. **Frontend:** SolidJS + MapLibre per selezionare punti e visualizzare GeoJSON, avvisi, qualità dei dati e compromessi.

Curvature e illuminazione saranno sempre indicatori approssimati. Le curve cieche restano un esperimento separato; la curvatura da sola non è sufficiente per classificarle.
