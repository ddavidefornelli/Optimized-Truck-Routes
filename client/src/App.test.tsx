import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { setLanguage } from './lib/i18n'
import type { RouteResult, RouteService } from './features/route-planner/domain'
import { demoResult } from './features/route-planner/demo'
import { RouteServiceError } from './lib/api/http'

vi.mock('./map/RouteMap', () => ({ default: () => <section aria-label="Route map" /> }))
beforeEach(() => setLanguage('en'))

function enterPoints() {
  fireEvent.input(screen.getByLabelText('Starting point'), { target: { value: '60.1699, 24.9384' } })
  fireEvent.input(screen.getByLabelText('Destination'), { target: { value: '60.3929, 25.6639' } })
}
function apiResult(): RouteResult {
  return { ...structuredClone(demoResult), mode: 'real', warnings: [], vehicle: { id: 'standard', version: '1', heightMeters: 4, widthMeters: 2.55, lengthMeters: 16.5, massKg: 32_000 } }
}
function calculate() { fireEvent.click(screen.getByRole('button', { name: 'Calculate route' })) }

it('renders a minimal branded planner and validates before calling the backend', async () => {
  const service = vi.fn<RouteService['calculate']>()
  render(() => <App service={{ calculate: service }} />)
  expect(screen.getByRole('heading', { name: 'Driver routes', level: 1 })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Valio Aimo, home' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Valio Aimo' })).toHaveAttribute('src', '/valio-aimo.svg')
  calculate()
  expect(screen.getAllByText('Enter a valid latitude and longitude.')).toHaveLength(2)
  expect(service).not.toHaveBeenCalled()
  enterPoints()
  fireEvent.input(screen.getByLabelText('Destination'), { target: { value: '60.1699, 24.9384' } })
  calculate()
  expect(screen.getByText('Destination must differ from the starting point.')).toBeInTheDocument()
  expect(service).not.toHaveBeenCalled()
})

it('renders API metrics, backend-authored warnings and vehicle parameters', async () => {
  const result = apiResult()
  result.routes[0].warnings = ['Compatibility not verified on some sections.']
  const service = vi.fn<RouteService['calculate']>().mockResolvedValue(result)
  render(() => <App service={{ calculate: service }} />)
  enterPoints()
  calculate()
  expect(service).toHaveBeenCalledWith(expect.objectContaining({ stops: expect.arrayContaining([expect.objectContaining({ kind: 'origin', coordinates: { latitude: 60.1699, longitude: 24.9384 } })]) }), expect.any(AbortSignal))
  expect(await screen.findByText('58.4 km')).toBeInTheDocument()
  expect(screen.getByText('52 min')).toBeInTheDocument()
  expect(screen.getByText('Compatibility not verified on some sections.')).toBeInTheDocument()
  expect(screen.getByText('standard · v1')).toBeInTheDocument()
  expect(screen.getByText('4 m')).toBeInTheDocument()
  expect(screen.getByText('32,000 kg')).toBeInTheDocument()
})

it('keeps demo explicit and never invokes the API for it', async () => {
  const service = vi.fn<RouteService['calculate']>()
  render(() => <App service={{ calculate: service }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Try an example' }))
  expect(await screen.findByText('58.4 km')).toBeInTheDocument()
  expect(screen.getByText('Demo mode')).toBeInTheDocument()
  expect(service).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Exit demo' }))
  expect(screen.queryByText('Demo mode')).not.toBeInTheDocument()
  expect(screen.queryByText('58.4 km')).not.toBeInTheDocument()
})

it('invalidates results as soon as stops change and swaps inputs', async () => {
  render(() => <App />)
  fireEvent.click(screen.getByRole('button', { name: 'Try an example' }))
  await screen.findByText('58.4 km')
  fireEvent.click(screen.getByRole('button', { name: 'Swap start and destination' }))
  expect(screen.getByLabelText('Starting point')).toHaveValue('60.39290, 25.66390')
  expect(screen.getByLabelText('Destination')).toHaveValue('60.16990, 24.93840')
  expect(screen.queryByText('58.4 km')).not.toBeInTheDocument()
  expect(screen.queryByText('Demo mode')).not.toBeInTheDocument()
})

it('shows translated backend failures without silently switching to demo', async () => {
  const service = vi.fn<RouteService['calculate']>().mockRejectedValue(new RouteServiceError('Il motore di routing non è ancora pronto. Riprova più tardi.', 'http_503'))
  render(() => <App service={{ calculate: service }} />)
  enterPoints()
  calculate()
  expect(await screen.findByRole('alert')).toHaveTextContent('The routing service is not ready yet. Try again later.')
  expect(screen.queryByText('58.4 km')).not.toBeInTheDocument()
  expect(screen.queryByText('Demo mode')).not.toBeInTheDocument()
})

it('displays no_route as a domain result', async () => {
  const service = vi.fn<RouteService['calculate']>().mockResolvedValue({ status: 'no_route', mode: 'real', routes: [], warnings: [], vehicle: null })
  render(() => <App service={{ calculate: service }} />)
  enterPoints()
  calculate()
  expect(await screen.findByText('No route found')).toBeInTheDocument()
})

it('ignores late responses after editing even if a service ignores cancellation', async () => {
  let resolve!: (result: RouteResult) => void
  let signal!: AbortSignal
  const service: RouteService['calculate'] = (_plan, requestSignal) => {
    signal = requestSignal
    return new Promise((done) => { resolve = done })
  }
  render(() => <App service={{ calculate: service }} />)
  enterPoints()
  calculate()
  expect(screen.getByRole('button', { name: 'Calculating route…' })).toBeDisabled()
  fireEvent.input(screen.getByLabelText('Destination'), { target: { value: '61, 25' } })
  expect(signal.aborted).toBe(true)
  resolve(apiResult())
  await waitFor(() => expect(screen.getByRole('button', { name: 'Calculate route' })).toBeEnabled())
  expect(screen.queryByText('58.4 km')).not.toBeInTheDocument()
})

it('can cancel a calculation and select another route', async () => {
  const result = apiResult()
  result.routes.push({ ...result.routes[0], id: 'shortest', name: 'Più breve ammissibile', distanceMeters: 50_000, durationSeconds: 3_600 })
  const service = vi.fn<RouteService['calculate']>()
    .mockImplementationOnce((_plan, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))) }))
    .mockResolvedValueOnce(result)
  render(() => <App service={{ calculate: service }} />)
  enterPoints()
  calculate()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel calculation' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  calculate()
  await screen.findByText('58.4 km')
  fireEvent.click(screen.getByRole('button', { name: 'Shortest permitted' }))
  expect(screen.getByText('50 km')).toBeInTheDocument()
  expect(screen.getByText('1 h')).toBeInTheDocument()
})

it('switches existing validation, demo content and metrics without losing inputs', async () => {
  setLanguage('fi')
  render(() => <App />)
  expect(document.documentElement.lang).toBe('fi')
  fireEvent.click(screen.getByRole('button', { name: 'Laske reitti' }))
  expect(screen.getAllByText('Syötä kelvollinen leveysaste ja pituusaste.')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getAllByText('Enter a valid latitude and longitude.')).toHaveLength(2)
  expect(document.documentElement.lang).toBe('en')
  expect(localStorage.getItem('valio-aimo-language')).toBe('en')
  fireEvent.click(screen.getByRole('button', { name: 'Try an example' }))
  await screen.findByText('58.4 km')
  fireEvent.click(screen.getByRole('button', { name: 'Suomi' }))
  expect(screen.getByText('58,4 km')).toBeInTheDocument()
  expect(screen.getByText('Demotila')).toBeInTheDocument()
  expect(screen.getByLabelText('Lähtöpaikka')).toHaveValue('60.16990, 24.93840')
  expect(document.title).toBe('Valio Aimo — Kuljettajan reitit')
})
