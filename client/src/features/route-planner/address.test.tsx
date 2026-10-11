import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { beforeEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { setLanguage } from '../../lib/i18n'
import type { AddressSearch, AddressSuggestion } from './address'
import type { RouteService } from './domain'
import { demoResult } from './demo'

vi.mock('../../map/RouteMap', () => ({ default: () => <section aria-label="Reittikartta" /> }))
beforeEach(() => setLanguage('fi'))
const start: AddressSuggestion = { id: 'start', label: 'Mannerheimintie 1, Helsinki', coordinates: { latitude: 60.17, longitude: 24.94 } }
const end: AddressSuggestion = { id: 'end', label: 'Aleksanterinkatu 1, Porvoo', coordinates: { latitude: 60.39, longitude: 25.66 } }

async function selectAddress(label: string, text: string, suggestion: AddressSuggestion) {
  const input = screen.getByLabelText(label)
  fireEvent.focus(input)
  fireEvent.input(input, { target: { value: text } })
  await screen.findByRole('option', { name: suggestion.label })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(input).toHaveValue(suggestion.label)
}

it('debounces address search, selects with keyboard, swaps coordinates and invalidates edits', async () => {
  const search = vi.fn<AddressSearch['search']>().mockImplementation(async (text) => text.startsWith('Manner') ? [start] : [end])
  const calculate = vi.fn<RouteService['calculate']>().mockResolvedValue({ ...demoResult, mode: 'real' })
  render(() => <App addressSearch={{ search }} service={{ calculate }} />)
  const input = screen.getByLabelText('Lähtöpaikka')
  fireEvent.focus(input)
  fireEvent.input(input, { target: { value: 'Ma' } })
  expect(search).not.toHaveBeenCalled()
  await selectAddress('Lähtöpaikka', 'Mannerheim', start)
  await selectAddress('Määränpää', 'Aleksanteri', end)
  expect(search).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: 'Vaihda lähtöpaikka ja määränpää' }))
  expect(input).toHaveValue(end.label)
  fireEvent.click(screen.getByRole('button', { name: 'Laske reitti' }))
  await screen.findByText('58,4 km')
  expect(calculate.mock.calls[0][0].stops.map((stop) => stop.coordinates)).toEqual([end.coordinates, start.coordinates])
  fireEvent.input(input, { target: { value: 'Another street' } })
  expect(screen.queryByText('58,4 km')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Laske reitti' }))
  expect(screen.getByText('Valitse osoite ehdotuksista tai kartalta.')).toBeInTheDocument()
  expect(calculate).toHaveBeenCalledTimes(1)
})

it('ignores stale search responses and supports pointer selection', async () => {
  let resolve!: (results: AddressSuggestion[]) => void
  let oldSignal!: AbortSignal
  const search = vi.fn<AddressSearch['search']>()
    .mockImplementationOnce((_text, signal) => { oldSignal = signal; return new Promise((done) => { resolve = done }) })
    .mockResolvedValueOnce([end])
  render(() => <App addressSearch={{ search }} />)
  const input = screen.getByLabelText('Lähtöpaikka')
  fireEvent.focus(input)
  fireEvent.input(input, { target: { value: 'Mannerheim' } })
  await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
  fireEvent.input(input, { target: { value: 'Aleksanteri' } })
  expect(oldSignal.aborted).toBe(true)
  resolve([start])
  const option = await screen.findByRole('option', { name: end.label })
  expect(screen.queryByRole('option', { name: start.label })).not.toBeInTheDocument()
  fireEvent.click(option)
  expect(input).toHaveValue(end.label)
  expect(input).toHaveAttribute('aria-expanded', 'false')
})

it('shows empty results and provider failures, but coordinates never trigger search', async () => {
  const search = vi.fn<AddressSearch['search']>().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Network'))
  render(() => <App addressSearch={{ search }} />)
  const input = screen.getByLabelText('Lähtöpaikka')
  fireEvent.focus(input)
  fireEvent.input(input, { target: { value: 'Unknown' } })
  await screen.findByText('Osoitteita ei löytynyt.')
  fireEvent.input(input, { target: { value: 'Helsinki' } })
  await screen.findByText('Haku ei ole käytettävissä. Yritä uudelleen tai valitse kartalta.')
  fireEvent.input(input, { target: { value: '60.17, 24.94' } })
  expect(input).toHaveAttribute('aria-expanded', 'false')
  expect(search).toHaveBeenCalledTimes(2)
})
