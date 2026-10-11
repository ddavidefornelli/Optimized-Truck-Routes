import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { expect, it, vi } from 'vitest'
import App from './App'
import type { RouteResult, RouteService } from './features/route-planner/domain'
import { demoResult } from './features/route-planner/demo'
import { RouteServiceError } from './lib/api/http'

// WebGL belongs to the browser tests. Component tests exercise the accessible UI.
vi.mock('./map/RouteMap', () => ({ default: () => <section aria-label="Mappa del percorso" /> }))

function enterPoints() {
  fireEvent.input(screen.getByLabelText('Punto di partenza'), { target: { value: '60.1699, 24.9384' } })
  fireEvent.input(screen.getByLabelText('Punto di arrivo'), { target: { value: '60.3929, 25.6639' } })
}

function apiResult(): RouteResult {
  return { ...structuredClone(demoResult), mode: 'real', warnings: [], vehicle: { id: 'standard', version: '1', heightMeters: 4, widthMeters: 2.55, lengthMeters: 16.5, massKg: 32_000 } }
}

it('renders a minimal planner and validates before calling the backend', async () => {
  const calculate = vi.fn<RouteService['calculate']>()
  render(() => <App service={{ calculate }} />)
  expect(screen.getByRole('heading', { name: 'Una rotta. Meno incertezze.' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Calcola percorso' }))
  expect(screen.getAllByText('Inserisci latitudine, longitudine valide.')).toHaveLength(2)
  expect(calculate).not.toHaveBeenCalled()
  enterPoints()
  fireEvent.input(screen.getByLabelText('Punto di arrivo'), { target: { value: '60.1699, 24.9384' } })
  fireEvent.click(screen.getByRole('button', { name: 'Calcola percorso' }))
  expect(screen.getByText('L’arrivo deve essere diverso dalla partenza.')).toBeInTheDocument()
  expect(calculate).not.toHaveBeenCalled()
})

it('calls the service and renders API metrics, warnings and actual vehicle parameters', async () => {
  const result = apiResult()
  result.routes[0].warnings = ['Compatibilità non verificata su alcuni tratti.']
  const calculate = vi.fn<RouteService['calculate']>().mockResolvedValue(result)
  render(() => <App service={{ calculate }} />)
  enterPoints()
  fireEvent.click(screen.getByRole('button', { name: 'Calcola percorso' }))
  expect(calculate).toHaveBeenCalledWith(expect.objectContaining({ stops: expect.arrayContaining([expect.objectContaining({ kind: 'origin', coordinates: { latitude: 60.1699, longitude: 24.9384 } })]) }), expect.any(AbortSignal))
  expect(await screen.findByText('58,4 km')).toBeInTheDocument()
  expect(screen.getByText('52 min')).toBeInTheDocument()
  expect(screen.getByText('Compatibilità non verificata su alcuni tratti.')).toBeInTheDocument()
  expect(screen.getByText('standard · v1')).toBeInTheDocument()
  expect(screen.getByText('4 m')).toBeInTheDocument()
  expect(screen.getByText('32.000 kg')).toBeInTheDocument()
})

it('keeps the demo explicit and never invokes the API for it', async () => {
  const calculate = vi.fn<RouteService['calculate']>()
  render(() => <App service={{ calculate }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Prova un esempio' }))
  expect(await screen.findByText('58,4 km')).toBeInTheDocument()
  expect(screen.getByText('Modalità demo')).toBeInTheDocument()
  expect(calculate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Esci dalla demo' }))
  expect(screen.queryByText('Modalità demo')).not.toBeInTheDocument()
  expect(screen.queryByText('58,4 km')).not.toBeInTheDocument()
})

it('invalidates results as soon as any stop changes and swaps inputs', async () => {
  render(() => <App />)
  fireEvent.click(screen.getByRole('button', { name: 'Prova un esempio' }))
  await screen.findByText('58,4 km')
  fireEvent.click(screen.getByRole('button', { name: 'Inverti partenza e arrivo' }))
  expect(screen.getByLabelText('Punto di partenza')).toHaveValue('60.39290, 25.66390')
  expect(screen.getByLabelText('Punto di arrivo')).toHaveValue('60.16990, 24.93840')
  expect(screen.queryByText('58,4 km')).not.toBeInTheDocument()
  expect(screen.queryByText('Modalità demo')).not.toBeInTheDocument()
})

it('shows backend failures without silently switching to demo', async () => {
  const calculate = vi.fn<RouteService['calculate']>().mockRejectedValue(new RouteServiceError('Backend non raggiungibile.', 'network'))
  render(() => <App service={{ calculate }} />)
  enterPoints()
  fireEvent.click(screen.getByRole('button', { name: 'Calcola percorso' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Backend non raggiungibile.')
  expect(screen.queryByText('58,4 km')).not.toBeInTheDocument()
  expect(screen.queryByText('Modalità demo')).not.toBeInTheDocument()
})

it('displays no_route as a domain result', async () => {
  const calculate = vi.fn<RouteService['calculate']>().mockResolvedValue({ status: 'no_route', mode: 'real', routes: [], warnings: [], vehicle: null })
  render(() => <App service={{ calculate }} />)
  enterPoints()
  fireEvent.click(screen.getByRole('button', { name: 'Calcola percorso' }))
  expect(await screen.findByText('Nessun percorso trovato')).toBeInTheDocument()
})

it('ignores late responses after editing even if a service ignores cancellation', async () => {
  let resolve!: (result: RouteResult) => void
  let signal!: AbortSignal
  const calculate: RouteService['calculate'] = (_plan, requestSignal) => {
    signal = requestSignal
    return new Promise((done) => { resolve = done })
  }
  render(() => <App service={{ calculate }} />)
  enterPoints()
  fireEvent.click(screen.getByRole('button', { name: 'Calcola percorso' }))
  expect(screen.getByRole('button', { name: 'Calcolo in corso…' })).toBeDisabled()
  fireEvent.input(screen.getByLabelText('Punto di arrivo'), { target: { value: '61, 25' } })
  expect(signal.aborted).toBe(true)
  resolve(apiResult())
  await waitFor(() => expect(screen.getByRole('button', { name: 'Calcola percorso' })).toBeEnabled())
  expect(screen.queryByText('58,4 km')).not.toBeInTheDocument()
})

it('can cancel a calculation and select another route', async () => {
  const result = apiResult()
  result.routes.push({ ...result.routes[0], id: 'shortest', name: 'Più breve ammissibile', distanceMeters: 50_000, durationSeconds: 3_600 })
  const calculate = vi.fn<RouteService['calculate']>()
    .mockImplementationOnce((_plan, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))) }))
    .mockResolvedValueOnce(result)
  render(() => <App service={{ calculate }} />)
  enterPoints()
  fireEvent.click(screen.getByRole('button', { name: 'Calcola percorso' }))
  fireEvent.click(screen.getByRole('button', { name: 'Annulla calcolo' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Calcola percorso' }))
  await screen.findByText('58,4 km')
  fireEvent.click(screen.getByRole('button', { name: 'Più breve ammissibile' }))
  expect(screen.getByText('50 km')).toBeInTheDocument()
  expect(screen.getByText('1 h')).toBeInTheDocument()
})
