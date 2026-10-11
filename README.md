# Optimized Truck Routes

Pianificazione di percorsi per camion in Finlandia, considerando restrizioni del veicolo, distanza, traffico e caratteristiche delle strade.

## Stato del progetto

La [specification](./SPECIFICATION.md) descrive obiettivi, dataset e modello di routing.

L'MVP userà un unico camion standard, con dimensioni e peso predefiniti (valori da concordare), senza configurazione utente. Il motore manterrà il profilo veicolo separato per supportare camion diversi nelle evoluzioni successive.

- `client/`: frontend minimale e responsive, Vite + SolidJS + TypeScript, Tailwind CSS e MapLibre. Inserimento coordinate o selezione sulla mappa, chiamata API, percorso GeoJSON e riepilogo; demo sintetica esplicita. Dipendenze gestite con Bun e `bun.lock`.
- `server/`: cartella riservata al futuro backend Python/FastAPI; non ancora implementato.

## Avvio del client

Richiede Bun 1.4.0 e Node.js compatibile con Vite/Vitest (qui verificato con Node 26.8.2).

```sh
cd client
bun install --frozen-lockfile
bun run dev
```

```sh
bun run build
bun run test
bunx playwright install chromium
bun run test:e2e
```

Per i test E2E sono necessarie anche le librerie di sistema richieste da Chromium.
Il backend non è ancora disponibile: **Prova un esempio** permette di verificare la UI senza server. La modalità reale chiama `POST /api/v1/routes`; il proxy di sviluppo punta a `http://127.0.0.1:8000`.

La mappa predefinita è una griglia geografica offline, senza strade. Provider della basemap e ricerca indirizzi non sono ancora configurati. Impostazioni in [`client/.env.example`](./client/.env.example), istruzioni nel [README del client](./client/README.md).

Il [contratto JSON provvisorio e l'architettura frontend](./docs/frontend.md) separano dominio e adapter API. Il modello usa già tappe ordinate; l'endpoint attuale supporta solo partenza e una consegna, senza eliminare silenziosamente tappe future. Il routing rimane responsabilità del backend.
