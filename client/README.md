# Client

Vite + SolidJS + TypeScript, con Tailwind CSS e MapLibre GL JS.
Gestione pacchetti: Bun. Il lockfile `bun.lock` va versionato.

```sh
bun install --frozen-lockfile
bun run dev
bun run build
bun run test
```

Test browser (Chromium):

```sh
bunx playwright install chromium
bun run test:e2e
```

È presente solo lo scaffold iniziale, non ancora l'interfaccia di pianificazione.
