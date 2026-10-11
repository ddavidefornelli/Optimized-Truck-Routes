import { expect, test } from '@playwright/test'
import { offlineStyle } from '../src/map/offlineStyle'

const response = {
  status: 'ok', mode: 'real', request_id: 'e2e-route', warnings: [],
  vehicle_profile: { id: 'standard', version: '1', height_m: 4, width_m: 2.55, length_m: 16.5, mass_kg: 32_000 },
  routes: [{ id: 'balanced', profiles: ['balanced'], distance_m: 58_400, duration_s: 3_120, geometry: { type: 'LineString', coordinates: [[24.9384, 60.1699], [25.2, 60.28], [25.6639, 60.3929]] } }],
}

test.beforeEach(async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json', (route) => route.fulfill({ json: offlineStyle() }))
  await page.route('**/api/v1/routes', (route) => route.fulfill({ json: response }))
  await page.route('https://api.geoapify.com/**', (route) => route.fulfill({ json: { features: [] } }))
})

test('defaults to Finnish and plans an API route on the map', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  let requestBody: unknown
  await page.route('**/api/v1/routes', (route) => {
    requestBody = route.request().postDataJSON()
    return route.fulfill({ json: response })
  })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'fi')
  await expect(page.getByRole('heading', { name: 'Kuljettajan reitit' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Valio Aimo' })).toBeVisible()
  expect(await page.getByRole('img', { name: 'Valio Aimo' }).evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await page.getByLabel('Lähtöpaikka', { exact: true }).fill('60.1699, 24.9384')
  await page.getByLabel('Määränpää', { exact: true }).fill('60.3929, 25.6639')
  await page.getByRole('button', { name: 'Laske reitti' }).click()
  await expect(page.getByText('58,4 km')).toBeVisible()
  await expect(page.getByText('52 min')).toBeVisible()
  await expect(page.locator('.map-pin')).toHaveCount(2)
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap')
  await expect(page.getByText('Kartta ei ole käytettävissä', { exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
  expect(requestBody).toMatchObject({ origin: { longitude: 24.9384, latitude: 60.1699 }, destination: { longitude: 25.6639, latitude: 60.3929 }, profiles: ['balanced'] })
  expect(requestBody).not.toHaveProperty('vehicle')
  await page.getByText('Käytetty ajoneuvoprofiili').click()
  await expect(page.getByText('32 000 kg')).toBeVisible()
  await page.getByLabel('Määränpää', { exact: true }).fill('61, 25')
  await expect(page.getByText('58,4 km')).toHaveCount(0)
})

test('supports explicit demo and selecting a point from the map', async ({ page }) => {
  let apiRequests = 0
  page.on('request', (request) => { if (request.url().includes('/api/v1/routes')) apiRequests++ })
  await page.goto('/')
  await page.getByRole('button', { name: 'Kokeile esimerkkiä' }).click()
  await expect(page.getByText('Demotila', { exact: true })).toBeVisible()
  await expect(page.getByText('58,4 km')).toBeVisible()
  await expect(page.locator('.map-pin')).toHaveCount(2)
  expect(apiRequests).toBe(0)
  await page.getByRole('button', { name: 'Valitse lähtöpaikka kartalta' }).click()
  await page.locator('.maplibregl-canvas').click({ position: { x: 150, y: 180 } })
  await expect(page.getByText('Demotila', { exact: true })).toHaveCount(0)
  await expect(page.getByText('58,4 km')).toHaveCount(0)
  await expect(page.getByLabel('Lähtöpaikka', { exact: true })).not.toHaveValue('60.16990, 24.93840')
})

test('communicates errors without replacing them with a simulated route', async ({ page }) => {
  await page.route('**/api/v1/routes', (route) => route.fulfill({ status: 503, json: { detail: 'Not ready' } }))
  await page.goto('/')
  await page.getByLabel('Lähtöpaikka', { exact: true }).fill('60.1699, 24.9384')
  await page.getByLabel('Määränpää', { exact: true }).fill('60.3929, 25.6639')
  await page.getByRole('button', { name: 'Laske reitti' }).click()
  await expect(page.getByRole('alert')).toContainText('Reitityspalvelu ei ole vielä valmis')
  await expect(page.getByText('58,4 km')).toHaveCount(0)
})

test('keeps route overlays usable when the basemap fails', async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.goto('/')
  await expect(page.getByText('Tiekartta ei ole käytettävissä.', { exact: false })).toBeVisible()
  await expect(page.getByText('Koordinaattiruudukko · ei teitä', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Kokeile esimerkkiä' }).click()
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('.map-pin')).toHaveCount(2)
  await expect(page.getByText('58,4 km')).toBeVisible()
})

test('remains usable on a narrow mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Laske reitti' })).toBeInViewport()
  await expect(page.getByRole('heading', { name: 'Kuljettajan reitit' })).toBeVisible()
  expect(await page.getByRole('button', { name: 'Laske reitti' }).evaluate((button) => getComputedStyle(button).backgroundColor)).toBe('rgb(192, 224, 33)')
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 812 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await page.getByLabel('Lähtöpaikka', { exact: true }).evaluate((input) => getComputedStyle(input).fontSize)).toBe('16px')
    for (const button of await page.locator('.planner-panel button, .language-switch button').all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
  }
  await page.getByRole('button', { name: 'Kokeile esimerkkiä' }).click()
  await expect(page.getByText('58,4 km')).toBeVisible()
  await page.getByRole('button', { name: 'Valitse lähtöpaikka kartalta' }).click()
  await expect(page.locator('.maplibregl-canvas')).toBeInViewport()
  await page.locator('.maplibregl-canvas').click({ position: { x: 150, y: 180 } })
  await expect(page.getByRole('button', { name: 'Valitse lähtöpaikka kartalta' })).toHaveAttribute('aria-pressed', 'false')
})

test('selects addresses on mobile and sends only coordinates to the backend', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const searchLanguages: string[] = []
  await page.route('https://api.geoapify.com/**', (route) => {
    const params = new URL(route.request().url()).searchParams
    searchLanguages.push(params.get('lang')!)
    const properties = params.get('text')?.startsWith('Manner')
      ? { place_id: 'start', formatted: 'Mannerheimintie 1, Helsinki', lat: 60.1699, lon: 24.9384 }
      : { place_id: 'end', formatted: 'Aleksanterinkatu 1, Porvoo', lat: 60.3929, lon: 25.6639 }
    return route.fulfill({ json: { features: [{ properties }] } })
  })
  let requestBody: unknown
  await page.route('**/api/v1/routes', (route) => {
    requestBody = route.request().postDataJSON()
    return route.fulfill({ json: response })
  })
  await page.goto('/')
  await page.getByLabel('Lähtöpaikka', { exact: true }).fill('Mannerheim')
  const start = page.getByRole('option', { name: 'Mannerheimintie 1, Helsinki' })
  await expect(start).toBeVisible()
  expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect(page.getByRole('link', { name: 'Powered by Geoapify' }).first()).toBeVisible()
  await start.click()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByLabel('Destination', { exact: true }).fill('Aleksanteri')
  await page.getByRole('option', { name: 'Aleksanterinkatu 1, Porvoo' }).click()
  expect(searchLanguages).toEqual(['fi', 'en'])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Calculate route' }).click()
  await expect(page.getByText('58.4 km')).toBeVisible()
  expect(requestBody).toMatchObject({ origin: { longitude: 24.9384, latitude: 60.1699 }, destination: { longitude: 25.6639, latitude: 60.3929 }, profiles: ['balanced'] })
  expect(requestBody).not.toHaveProperty('apiKey')
  expect(requestBody).not.toHaveProperty('address')
  await expect(page.locator('.map-pin')).toHaveCount(2)
  await page.getByLabel('Destination', { exact: true }).fill('Unselected address')
  await page.getByRole('button', { name: 'Calculate route' }).click()
  await expect(page.getByText('Select an address from the suggestions or choose on the map.')).toBeVisible()
  await expect(page.getByText('58.4 km')).toHaveCount(0)
})

test('switches language without losing a route and remembers the choice', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Kokeile esimerkkiä' }).click()
  await expect(page.getByText('58,4 km')).toBeVisible()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByText('58.4 km')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible()
  await expect(page.getByLabel('Starting point', { exact: true })).toHaveValue('60.16990, 24.93840')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Calculate route' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('button', { name: 'Suomi', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Laske reitti' })).toBeVisible()
})
