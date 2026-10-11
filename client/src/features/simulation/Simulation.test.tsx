import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setLanguage } from '../../lib/i18n'
import { initialState } from './driving'
import type { SimulationHooks } from './scene'
import Simulation from './Simulation'

const engine = vi.hoisted(() => ({ create: vi.fn(), start: vi.fn(), pause: vi.fn(), reset: vi.fn(), dispose: vi.fn() }))
vi.mock('./scene', () => ({ createSimulation: engine.create }))
let hooks: SimulationHooks
beforeEach(() => {
  vi.clearAllMocks()
  setLanguage('en')
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  engine.create.mockImplementation((_canvas: HTMLCanvasElement, callbacks: SimulationHooks) => {
    hooks = callbacks
    hooks.tick(initialState('narrow'))
    return engine
  })
  engine.reset.mockImplementation((mode) => hooks.tick(initialState(mode)))
})
afterEach(() => vi.unstubAllGlobals())

it('starts explicitly and translates a live run without resetting it', async () => {
  render(() => <Simulation />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start driving' }))
  expect(engine.start).toHaveBeenCalledOnce()
  expect(screen.getByRole('application')).toHaveAttribute('data-phase', 'running')
  hooks.tick({ ...initialState('narrow'), speed: 3.5, progress: 0.2, clearance: 0.64 })
  fireEvent.click(screen.getByRole('button', { name: 'Suomi' }))
  expect(screen.getByTestId('sim-clearance')).toHaveTextContent('0,64 m')
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0.2')
  expect(screen.getByRole('application')).toHaveAttribute('data-phase', 'running')
  expect(document.title).toBe('Valio Aimo — Ajosimulaattori')
  expect(document.documentElement.lang).toBe('fi')
  expect(engine.reset).not.toHaveBeenCalled()
})

it('pauses with a focused resume action and resets explicitly when changing conditions', async () => {
  render(() => <Simulation />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start driving' }))
  hooks.paused()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Resume driving' })).toHaveFocus())
  fireEvent.click(screen.getByRole('button', { name: /Wider & lit/ }))
  expect(engine.reset).toHaveBeenCalledWith('wide')
  expect(screen.getByTestId('sim-clearance')).toHaveTextContent('1.63 m')
  expect(screen.getByRole('application')).toHaveAttribute('data-scenario', 'wide')
  expect(screen.getByRole('application')).toHaveAttribute('data-phase', 'ready')
})

it('keeps both completed runs for a small, localized comparison', async () => {
  render(() => <Simulation />)
  await screen.findByRole('button', { name: 'Start driving' })
  hooks.finished({ ...initialState('narrow'), progress: 1, finished: true, elapsed: 68.4, contacts: 2 })
  expect(screen.getByRole('table', { name: 'Latest completed runs' })).toHaveTextContent('68.4 s')
  expect(screen.getByText('Not driven yet')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try the wider road' }))
  hooks.finished({ ...initialState('wide'), progress: 1, finished: true, elapsed: 43.2, contacts: 0 })
  expect(screen.getByRole('table', { name: 'Latest completed runs' })).toHaveTextContent('43.2 s')
  expect(screen.getByRole('table', { name: 'Latest completed runs' })).toHaveTextContent('68.4 s')
  fireEvent.click(screen.getByRole('button', { name: 'Suomi' }))
  expect(screen.getByRole('table', { name: 'Viimeisimmät valmiit ajot' })).toHaveTextContent('68,4 s')
})

it('reports renderer failure and disposes its engine on unmount', async () => {
  const view = render(() => <Simulation />)
  await screen.findByRole('button', { name: 'Start driving' })
  hooks.error()
  expect(screen.getByRole('heading', { name: '3D view unavailable' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Wider & lit/ })).toBeDisabled()
  view.unmount()
  expect(engine.dispose).toHaveBeenCalledOnce()
})
