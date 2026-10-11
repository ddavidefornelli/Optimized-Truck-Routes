# Optimized Truck Routes

Pianificazione di percorsi per camion in Finlandia, considerando restrizioni del veicolo, distanza, traffico e caratteristiche delle strade.

## Stato del progetto

La [specification](./SPECIFICATION.md) descrive obiettivi, dataset e modello di routing.

L'MVP userà un unico camion standard, con dimensioni e peso predefiniti (valori da concordare), senza configurazione utente. Il motore manterrà il profilo veicolo separato per supportare camion diversi nelle evoluzioni successive.

- `client/`: scaffold Vite + SolidJS + TypeScript, Tailwind CSS e MapLibre. Dipendenze gestite con Bun e `bun.lock`.
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
Il client mostra ancora la schermata iniziale Vite: mappa, routing e integrazione backend non sono implementati.
