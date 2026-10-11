import { createMemo, createSignal, onCleanup } from 'solid-js'
import type { AddressSuggestion } from './address'
import type { Coordinates, RouteResult, RouteService } from './domain'
import { createPlan, formatCoordinates, parseCoordinates, sameCoordinates } from './domain'
import { createDemoRouteService, demoPlan } from './demo'
import { RouteServiceError } from '../../lib/api/http'

export type StopKey = 'origin' | 'destination'

export function createRoutePlanner(api: RouteService, demo: RouteService = createDemoRouteService()) {
  const [origin, setOrigin] = createSignal('')
  const [destination, setDestination] = createSignal('')
  const [addresses, setAddresses] = createSignal<Partial<Record<StopKey, AddressSuggestion>>>({})
  const [mode, setMode] = createSignal<'api' | 'demo'>('api')
  const [picking, setPicking] = createSignal<StopKey | null>(null)
  const [errors, setErrors] = createSignal<Partial<Record<StopKey, string>>>({})
  const [error, setError] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [result, setResult] = createSignal<RouteResult>()
  const [selectedId, setSelectedId] = createSignal('')
  const selectedRoute = createMemo(() => result()?.routes.find((route) => route.id === selectedId()))
  const points = createMemo(() => ({
    origin: addresses().origin?.coordinates ?? parseCoordinates(origin()),
    destination: addresses().destination?.coordinates ?? parseCoordinates(destination()),
  }))
  let controller: AbortController | undefined
  let generation = 0

  function invalidate() {
    generation++
    controller?.abort()
    controller = undefined
    setLoading(false)
    setResult(undefined)
    setError('')
    setErrors({})
    setSelectedId('')
  }

  function update(key: StopKey, value: string) {
    invalidate()
    setMode('api')
    setAddresses((current) => ({ ...current, [key]: undefined }))
    if (key === 'origin') setOrigin(value)
    else setDestination(value)
  }

  function selectAddress(key: StopKey, suggestion: AddressSuggestion) {
    update(key, suggestion.label)
    setAddresses((current) => ({ ...current, [key]: suggestion }))
    setPicking(null)
  }

  function pick(point: Coordinates) {
    const key = picking()
    if (!key) return
    update(key, formatCoordinates(point))
    setPicking(null)
  }

  async function calculate() {
    invalidate()
    setPicking(null)
    const { origin: start, destination: end } = points()
    const validation: Partial<Record<StopKey, string>> = {}
    if (!start) validation.origin = origin().trim() && !parseCoordinates(origin()) ? 'Seleziona un indirizzo dai suggerimenti o scegli sulla mappa.' : 'Inserisci latitudine, longitudine valide.'
    if (!end) validation.destination = destination().trim() && !parseCoordinates(destination()) ? 'Seleziona un indirizzo dai suggerimenti o scegli sulla mappa.' : 'Inserisci latitudine, longitudine valide.'
    if (start && end && sameCoordinates(start, end)) validation.destination = 'L’arrivo deve essere diverso dalla partenza.'
    setErrors(validation)
    if (!start || !end || Object.keys(validation).length) return

    const request = ++generation
    controller = new AbortController()
    const signal = controller.signal
    setLoading(true)
    try {
      const response = await (mode() === 'demo' ? demo : api).calculate(createPlan(start, end), signal)
      if (request !== generation || signal.aborted) return
      setResult(response)
      setSelectedId(response.routes[0]?.id ?? '')
    } catch (cause) {
      if (request !== generation || signal.aborted) return
      setError(cause instanceof RouteServiceError ? cause.message : 'Si è verificato un errore durante il calcolo. Riprova.')
    } finally {
      if (request === generation) {
        setLoading(false)
        controller = undefined
      }
    }
  }

  function showDemo() {
    invalidate()
    setAddresses({})
    setOrigin(formatCoordinates(demoPlan.stops[0].coordinates))
    setDestination(formatCoordinates(demoPlan.stops[1].coordinates))
    setMode('demo')
    return calculate()
  }

  function exitDemo() {
    invalidate()
    setMode('api')
  }

  function swap() {
    const start = origin()
    const currentAddresses = addresses()
    invalidate()
    setAddresses({ origin: currentAddresses.destination, destination: currentAddresses.origin })
    setMode('api')
    setOrigin(destination())
    setDestination(start)
    setPicking(null)
  }

  onCleanup(() => { generation++; controller?.abort() })

  return {
    origin, destination, mode, picking, errors, error, loading, result, selectedRoute, points,
    addresses, selectAddress, update, pick, calculate, showDemo, exitDemo, swap, cancel: invalidate,
    selectRoute: setSelectedId,
    togglePicking: (key: StopKey) => setPicking((current) => current === key ? null : key),
  }
}
