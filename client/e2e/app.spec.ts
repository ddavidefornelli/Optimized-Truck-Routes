import { expect, test } from '@playwright/test'

const response = {
  status: 'ok', mode: 'real', request_id: 'e2e-route', warnings: [],
  vehicle_profile: { id: 'standard', version: '1', height_m: 4, width_m: 2.55, length_m: 16.5, mass_kg: 32_000 },
  routes: [{ id: 'balanced', profiles: ['balanced'], distance_m: 58_400, duration_s: 3_120, geometry: { type: 'LineString', coordinates: [[24.9384, 60.1699], [25.2, 60.28], [25.6639, 60.3929]] } }],
}

test.beforeEach(async ({ page }) => {
  // All tests are offline and deterministic, including the default geographic grid.
  await page.route('**/api/v1/routes', (route) => route.fulfill({ json: response }))
})

test('plans a route through the API and displays it on the map', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  let requestBody: unknown
  await page.route('**/api/v1/routes', (route) => {
    requestBody = route.request().postDataJSON()
    return route.fulfill({ json: response })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Una rotta. Meno incertezze.' })).toBeVisible()
  await page.getByLabel('Punto di partenza', { exact: true }).fill('60.1699, 24.9384')
  await page.getByLabel('Punto di arrivo', { exact: true }).fill('60.3929, 25.6639')
  await page.getByRole('button', { name: 'Calcola percorso' }).click()
  await expect(page.getByText('58,4 km')).toBeVisible()
  await expect(page.getByText('52 min')).toBeVisible()
  await expect(page.getByText('Percorso selezionato', { exact: true })).toBeVisible()
  await expect(page.locator('.map-pin')).toHaveCount(2)
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByText('Mappa non disponibile', { exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
  expect(requestBody).toMatchObject({ origin: { longitude: 24.9384, latitude: 60.1699 }, destination: { longitude: 25.6639, latitude: 60.3929 }, profiles: ['balanced'] })
  expect(requestBody).not.toHaveProperty('vehicle')
  await page.getByText('Profilo veicolo applicato').click()
  await expect(page.getByText('32.000 kg')).toBeVisible()
  await page.getByLabel('Punto di arrivo', { exact: true }).fill('61, 25')
  await expect(page.getByText('58,4 km')).toHaveCount(0)
})

test('supports explicit demo and selecting a point from the map', async ({ page }) => {
  let apiRequests = 0
  page.on('request', (request) => { if (request.url().includes('/api/v1/routes')) apiRequests++ })
  await page.goto('/')
  await page.getByRole('button', { name: 'Prova un esempio' }).click()
  await expect(page.getByText('Modalità demo', { exact: true })).toBeVisible()
  await expect(page.getByText('58,4 km')).toBeVisible()
  await expect(page.locator('.map-pin')).toHaveCount(2)
  expect(apiRequests).toBe(0)
  await page.getByRole('button', { name: 'Scegli partenza sulla mappa' }).click()
  await page.locator('.maplibregl-canvas').click({ position: { x: 150, y: 180 } })
  await expect(page.getByText('Modalità demo', { exact: true })).toHaveCount(0)
  await expect(page.getByText('58,4 km')).toHaveCount(0)
  await expect(page.getByLabel('Punto di partenza', { exact: true })).not.toHaveValue('60.16990, 24.93840')
})

test('communicates errors without replacing them with a simulated route', async ({ page }) => {
  await page.route('**/api/v1/routes', (route) => route.fulfill({ status: 503, json: { detail: 'Not ready' } }))
  await page.goto('/')
  await page.getByLabel('Punto di partenza', { exact: true }).fill('60.1699, 24.9384')
  await page.getByLabel('Punto di arrivo', { exact: true }).fill('60.3929, 25.6639')
  await page.getByRole('button', { name: 'Calcola percorso' }).click()
  await expect(page.getByRole('alert')).toContainText('Il motore di routing non è ancora pronto')
  await expect(page.getByText('58,4 km')).toHaveCount(0)
})

test('remains usable on a narrow mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Prova un esempio' }).click()
  await expect(page.getByText('58,4 km')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByLabel('Punto di partenza', { exact: true })).toBeVisible()
})
