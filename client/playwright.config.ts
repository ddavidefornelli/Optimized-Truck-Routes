import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:5173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun run dev --host 127.0.0.1 --port 5173 --strictPort',
    env: { VITE_GEOAPIFY_API_KEY: 'e2e-test-key' },
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
})
