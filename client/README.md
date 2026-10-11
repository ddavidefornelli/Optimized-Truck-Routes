# Client — Truck Routes

Interfaccia minimale in italiano, SolidJS + TypeScript + Vite, con mappa MapLibre caricata separatamente. Palette blu navy, teal e superfici chiare; layout responsive e controlli accessibili.

## Avvio

```sh
bun install --frozen-lockfile
cp .env.example .env.local  # facoltativo
bun run dev
```

Il backend non è ancora implementato. **Prova un esempio** mostra un percorso sintetico locale, esplicitamente etichettato e non utilizzabile per la guida. Non sostituisce mai automaticamente una richiesta API fallita. Modificare i punti o uscire dalla demo riattiva la modalità API e invalida il risultato.

Nella modalità reale, inserire `latitudine, longitudine` con il punto per i decimali, oppure scegliere ciascun punto sulla mappa. La ricerca indirizzi richiede un geocoder e non è ancora disponibile. Le coordinate sono validate globalmente; la copertura effettiva del grafo va verificata dal backend.

## Configurazione

Vedi [`.env.example`](./.env.example).

| Variabile | Default | Utilizzo |
| --- | --- | --- |
| `API_PROXY_TARGET` | `http://127.0.0.1:8000` | Proxy `/api` del server di sviluppo, non della build di produzione. |
| `VITE_API_BASE_URL` | stessa origine | URL pubblico del backend. Se cross-origin, configurare CORS nel backend. |
| `VITE_ROUTES_ENDPOINT` | `/api/v1/routes` | Endpoint POST di routing. |
| `VITE_MAP_STYLE_URL` | vuoto | Style JSON MapLibre del provider scelto. |

Senza style configurato, la mappa mostra una **griglia geografica offline**, i punti e i percorsi, non strade inventate. Non fa richieste a provider terzi. Per una basemap reale configurare provider, termini d'uso, attribuzioni e credenziali pubbliche appropriate. MapLibre mostra le attribuzioni del provider se definite nelle sorgenti dello style. Con WebGL non disponibile, coordinate e riepilogo rimangono utilizzabili.

I valori `VITE_*` sono pubblici e inclusi nella build: **non inserirvi segreti**. In produzione configurare un reverse proxy `/api` oppure `VITE_API_BASE_URL`; i valori vengono letti al build, quindi ricostruire il client quando cambiano.

## Architettura e contratto API

Vedi [docs/frontend.md](../docs/frontend.md) per il contratto JSON provvisorio e i punti di estensione.

- `src/features/route-planner/domain.ts`: modello interno, coordinate, metriche, lista ordinata di tappe.
- `src/features/route-planner/createRoutePlanner.ts`: stato, validazione, cancellazione e protezione da risposte obsolete.
- `src/lib/api/http.ts`: trasporto JSON, timeout e messaggi di errore.
- `src/lib/api/routes-v1.ts`: unico adapter tra dominio e JSON, con validazione runtime.
- `src/features/route-planner/demo.ts`: fixture sintetica opt-in, separata dall'API.
- `src/map/`: rendering GeoJSON, punti selezionabili e sfondo offline.

Il frontend non calcola il routing né inventa dimensioni del camion, tempi o distanze. Le metriche reali e il profilo veicolo sono quelli della risposta API. Dati mancanti appaiono come non disponibili; avvisi del backend sono visibili anche fuori dalla mappa.

## Verifiche

```sh
bun run build
bun run test
bunx playwright install chromium
bun run test:e2e
```

I test non dipendono da servizi esterni: adapter, trasporto e componenti in Vitest; chiamata HTTP, mappa, demo e layout mobile in Playwright con API intercettata.
