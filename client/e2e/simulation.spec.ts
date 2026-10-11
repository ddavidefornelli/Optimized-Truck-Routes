import { expect, test } from '@playwright/test'

test('direct simulator URL renders locally, defaults to Finnish, and remembers language', async ({ page }) => {
  const errors: string[] = []
  const remoteRequests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:5173')) remoteRequests.push(request.url()) })
  await page.goto('/cool-simulation')
  await expect(page.getByRole('button', { name: 'Aloita ajo', exact: true })).toBeVisible({ timeout: 20000 })
  await expect(page.locator('html')).toHaveAttribute('lang', 'fi')
  await expect(page.getByRole('heading', { name: 'Jokikatu, Vanha Porvoo' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Kapea ja hämärä', exact: false })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('sim-clearance')).toHaveText('1,13 m')
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start driving', exact: true })).toBeVisible()
  await expect(page.getByTestId('sim-clearance')).toHaveText('1.13 m')
  await expect(page.getByText('A fictional street inspired', { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Start driving', exact: true })).toBeVisible({ timeout: 20000 })
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(errors).toEqual([])
  expect(remoteRequests).toEqual([])
})

test('WASD, mouse look, restart, pause, and switching roads work in the real Three.js view', async ({ page }) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/cool-simulation')
  await page.getByRole('button', { name: 'English', exact: true }).click()
  const canvas = page.locator('.sim-canvas')
  await page.getByRole('button', { name: 'Start driving', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-phase', 'running')
  await page.keyboard.down('w')
  await expect.poll(async () => parseFloat((await page.getByTestId('sim-speed').textContent())!), { timeout: 15000 }).toBeGreaterThan(3)
  await page.keyboard.up('w')
  await expect.poll(async () => Number(await page.getByRole('progressbar').getAttribute('value'))).toBeGreaterThan(0)
  await page.keyboard.down(' ')
  await expect.poll(async () => parseFloat((await page.getByTestId('sim-speed').textContent())!)).toBe(0)
  await page.keyboard.up(' ')
  await page.waitForTimeout(250)
  const before = await canvas.screenshot()
  // CDP emits cursor warps rather than relative movement while pointer-locked.
  // Supply a bounded relative mouse event to exercise the actual look handler.
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 48, movementY: 12, bubbles: true })))
  await expect.poll(async () => before.equals(await canvas.screenshot()), { timeout: 10000 }).toBe(false)
  await page.keyboard.press('r')
  await expect(page.getByTestId('sim-speed')).toHaveText('0 km/h')
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '0')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Resume driving', exact: true })).toBeVisible()
  await expect(canvas).toHaveAttribute('data-phase', 'paused')
  const progress = await page.getByRole('progressbar').getAttribute('value')
  await page.keyboard.press('w')
  await page.waitForTimeout(300)
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', progress!)
  await page.getByRole('button', { name: 'Wider & lit', exact: false }).click()
  await expect(canvas).toHaveAttribute('data-scenario', 'wide')
  await expect(page.getByTestId('sim-clearance')).toHaveText('1.63 m')
  await expect(page.getByTestId('sim-contacts')).toHaveText('0')
  await page.getByRole('button', { name: 'Start driving', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-phase', 'running')
  await page.keyboard.press('Tab')
  await expect(canvas).toHaveAttribute('data-phase', 'paused')
  await expect(page.getByRole('button', { name: 'Resume driving', exact: true })).toBeFocused()
  expect(errors).toEqual([])
})

test('mouse capture rejection keeps keyboard driving and drag-to-look available', async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestPointerLock = () => Promise.reject(new Error('Capture disabled for test'))
  })
  await page.goto('/cool-simulation')
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Start driving', exact: true }).click()
  await expect(page.getByText('Mouse capture is unavailable.', { exact: false })).toBeVisible()
  await page.keyboard.down('w')
  await expect.poll(async () => parseFloat((await page.getByTestId('sim-speed').textContent())!), { timeout: 15000 }).toBeGreaterThan(1)
  await page.keyboard.up('w')
  await page.getByRole('button', { name: 'Pause driving', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resume driving', exact: true })).toBeVisible()
})

test('WebGL failure shows a localized recovery message instead of a broken canvas', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type.startsWith('webgl')) return null
      return original.call(this, type, ...args)
    } as typeof original
  })
  await page.goto('/cool-simulation')
  await expect(page.getByRole('heading', { name: '3D-näkymä ei ole käytettävissä' })).toBeVisible({ timeout: 20000 })
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('heading', { name: '3D view unavailable' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Route planner', exact: true })).toHaveAttribute('href', '/')
  await expect(page.getByRole('button', { name: 'Narrow & dim', exact: false })).toBeDisabled()
})

test('narrow layouts stay readable with 44px actions, and the planner links to the demo', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/cool-simulation/')
  await expect(page.getByRole('button', { name: 'Aloita ajo', exact: true })).toBeVisible({ timeout: 20000 })
  for (const width of [320, 375, 430, 768]) {
    await page.setViewportSize({ width, height: 812 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    for (const button of await page.locator('.simulation-page button').all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
  }
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Ajosimulaattori', exact: true })).toHaveAttribute('href', '/cool-simulation')
})
