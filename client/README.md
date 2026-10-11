# Client — Truck Routes

Interfaccia minimale in italiano, SolidJS + TypeScript + Vite, con mappa MapLibre caricata separatamente. Palette blu navy, teal e superfici chiare; layout responsive e controlli accessibili.

## Avvio

```sh
bun install --frozen-lockfile
cp .env.example .env.local  # facoltativo
bun run dev
```

Il backend non è ancora implementato. **Prova un esempio** mostra un percorso sintetico locale, esplicitamente etichettato e non utilizzabile per la guida. Non sostituisce mai automaticamente una richiesta API fallita. Modificare i punti o uscire dalla demo riattiva la modalità API e invalida il risultato.

Nella modalità reale, cercare un indirizzo e selezionare un suggerimento **Geoapify**, inserire `latitudine, longitudine` con il punto per i decimali, oppure scegliere ciascun punto sulla mappa. La ricerca è limitata alla Finlandia per l'area pilota e richiede `VITE_GEOAPIFY_API_KEY`. Parte dopo 3 caratteri e 300 ms senza modifiche; richieste obsolete vengono annullate e ignorate. Il nome selezionato resta nel campo, ma solo le coordinate vengono inviate al backend. Modificare un indirizzo elimina immediatamente le coordinate associate e il risultato precedente: un testo non selezionato non può essere usato per calcolare. La copertura effettiva del grafo va verificata dal backend.

## Configurazione

Vedi [`.env.example`](./.env.example).

| Variabile | Default | Utilizzo |
| --- | --- | --- |
| `API_PROXY_TARGET` | `http://127.0.0.1:8000` | Proxy `/api` del server di sviluppo, non della build di produzione. |
| `VITE_API_BASE_URL` | stessa origine | URL pubblico del backend. Se cross-origin, configurare CORS nel backend. |
| `VITE_ROUTES_ENDPOINT` | `/api/v1/routes` | Endpoint POST di routing. |
| `VITE_MAP_STYLE_URL` | CARTO Positron | Override dello style JSON MapLibre; vuoto usa la mappa stradale chiara CARTO. |
| `VITE_GEOAPIFY_API_KEY` | disabilitato | Chiave pubblica browser per ricerca indirizzi Geoapify; impostarla in `.env.local` (ignorato da Git). |

La mappa predefinita è **CARTO Positron**, una basemap stradale chiara con dati OpenStreetMap, renderizzata da MapLibre. Style, tile, sprite e font vengono richiesti al CDN pubblico CARTO; le attribuzioni OpenStreetMap e CARTO rimangono visibili nel controllo della mappa. Verificare i [termini del provider](https://carto.com/legal/) per l'uso in produzione. `VITE_MAP_STYLE_URL` consente di scegliere un altro provider. Se la basemap non è raggiungibile, un avviso esplicito segnala il passaggio alla **griglia geografica offline**, mantenendo punti e percorsi senza inventare strade. Con WebGL non disponibile, coordinate e riepilogo rimangono utilizzabili.

La chiave Geoapify è visibile nel browser: limitarla alle origini autorizzate nella dashboard, monitorare la quota e non commetterla nel repository. Le query vengono inviate direttamente a Geoapify; nessuna ricerca viene eseguita per coordinate valide. Senza chiave, o in caso di errore del provider, coordinate manuali e selezione sulla mappa restano disponibili. L'attribuzione Geoapify appare insieme ai suggerimenti.

I valori `VITE_*` sono pubblici e inclusi nella build: **non inserirvi segreti**. In produzione configurare un reverse proxy `/api` oppure `VITE_API_BASE_URL`; i valori vengono letti al build, quindi ricostruire il client quando cambiano.

## Architettura e contratto API

Vedi [docs/frontend.md](../docs/frontend.md) per il contratto JSON provvisorio e i punti di estensione.

- `src/features/route-planner/domain.ts`: modello interno, coordinate, metriche, lista ordinata di tappe.
- `src/features/route-planner/createRoutePlanner.ts`: stato, validazione, cancellazione e protezione da risposte obsolete.
- `src/lib/api/http.ts`: trasporto JSON, timeout e messaggi di errore.
- `src/lib/api/routes-v1.ts`: unico adapter tra dominio e JSON, con validazione runtime.
- `src/lib/api/geoapify.ts`: adapter di ricerca, valida il JSON Geoapify e restituisce suggerimenti con coordinate del dominio.
- `src/features/route-planner/StopField.tsx`: autocomplete accessibile con tastiera e selezione touch.
- `src/features/route-planner/demo.ts`: fixture sintetica opt-in, separata dall'API.
- `src/map/`: rendering GeoJSON, punti selezionabili, basemap CARTO Positron e fallback offline.

Il frontend non calcola il routing né inventa dimensioni del camion, tempi o distanze. Le metriche reali e il profilo veicolo sono quelli della risposta API. Dati mancanti appaiono come non disponibili; avvisi del backend sono visibili anche fuori dalla mappa.

## Verifiche

```sh
bun run build
bun run test
bunx playwright install chromium
bun run test:e2e
```

I test non dipendono da servizi esterni: adapter, trasporto e componenti in Vitest; chiamata HTTP, mappa, demo e layout mobile in Playwright con API intercettata.
