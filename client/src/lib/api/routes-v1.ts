import type { Coordinates, RouteGeometry, RouteOption, RoutePlan, RouteResult, RouteService, VehicleSummary } from '../../features/route-planner/domain'
import { sameCoordinates } from '../../features/route-planner/domain'
import { createHttpClient, RouteServiceError } from './http'

// The only module that knows the provisional /api/v1/routes wire format.
// Add a new adapter for a breaking contract; don't leak DTOs into components.
function invalid(): never {
  throw new RouteServiceError('La risposta del backend non è compatibile con il contratto di routing configurato.', 'invalid_response')
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : invalid()
}

function metric(value: unknown): number | null {
  if (value === undefined || value === null) return null
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid()
}

function messages(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) return invalid()
  return value.map(text)
}

function coordinate(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return invalid()
  const [longitude, latitude] = value
  if (typeof longitude !== 'number' || typeof latitude !== 'number' || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return invalid()
  return [longitude, latitude]
}

function line(value: unknown): [number, number][] {
  if (!Array.isArray(value) || value.length < 2) return invalid()
  return value.map(coordinate)
}

function geometry(value: unknown): RouteGeometry {
  const input = object(value)
  if (input.type === 'Feature') return geometry(input.geometry)
  if (input.type === 'LineString') return { type: 'LineString', coordinates: line(input.coordinates) }
  if (input.type === 'MultiLineString' && Array.isArray(input.coordinates) && input.coordinates.length) {
    return { type: 'MultiLineString', coordinates: input.coordinates.map(line) }
  }
  return invalid()
}

function vehicle(value: unknown): VehicleSummary | null {
  if (value === undefined || value === null) return null
  const input = object(value)
  return {
    id: text(input.id), version: text(input.version),
    heightMeters: metric(input.height_m), widthMeters: metric(input.width_m),
    lengthMeters: metric(input.length_m), massKg: metric(input.mass_kg),
  }
}

function validPoint(point: Coordinates): boolean {
  return Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180 && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
}

export function encodeRouteRequest(plan: RoutePlan) {
  // Never silently drop future delivery stops on an endpoint that only supports two.
  if (plan.stops.length !== 2 || plan.stops[0].kind !== 'origin' || plan.stops[1].kind !== 'delivery') {
    throw new RouteServiceError('Questa versione dell’API supporta una sola consegna per viaggio.', 'unsupported_stops')
  }
  const [origin, destination] = plan.stops.map((stop) => stop.coordinates)
  if (!validPoint(origin) || !validPoint(destination) || sameCoordinates(origin, destination)) {
    throw new RouteServiceError('Inserisci due punti validi e distinti.', 'invalid_request')
  }
  return {
    origin, destination,
    profiles: ['balanced'],
    preferences: {
      unpaved: 'avoid', narrow_roads: 'avoid', urban_areas: 'avoid',
      tight_curves: 'avoid', unlit_at_night: 'avoid', unknown_critical_restrictions: 'warn',
    },
  }
}

export function decodeRouteResponse(value: unknown): RouteResult {
  const input = object(value)
  if (input.status !== 'ok' && input.status !== 'no_route') return invalid()
  if (input.mode !== undefined && input.mode !== 'demo' && input.mode !== 'real') return invalid()
  if (input.routes !== undefined && !Array.isArray(input.routes)) return invalid()
  if (input.status === 'ok' && (!Array.isArray(input.routes) || !input.routes.length)) return invalid()
  if (input.status === 'no_route' && Array.isArray(input.routes) && input.routes.length) return invalid()
  const ids = new Set<string>()
  const routes: RouteOption[] = ((input.routes ?? []) as unknown[]).map((value) => {
    const route = object(value)
    const id = text(route.id)
    if (ids.has(id)) return invalid()
    ids.add(id)
    const names: Record<string, string> = { balanced: 'Bilanciato', shortest: 'Più breve ammissibile', road_comfort: 'Minori penalità stradali' }
    const profile = Array.isArray(route.profiles) ? route.profiles.find((item) => typeof item === 'string' && item in names) : undefined
    return {
      id, name: route.name === undefined ? (profile ? names[profile as string] : 'Percorso') : text(route.name),
      geometry: geometry(route.geometry), distanceMeters: metric(route.distance_m),
      durationSeconds: metric(route.duration_s), warnings: messages(route.warnings),
    }
  })
  return {
    status: input.status, mode: input.mode ?? 'unknown',
    requestId: input.request_id === undefined ? undefined : text(input.request_id),
    routes, warnings: messages(input.warnings), vehicle: vehicle(input.vehicle_profile),
  }
}

export function createApiRouteService(options: Parameters<typeof createHttpClient>[0] & { endpoint?: string } = {}): RouteService {
  const http = createHttpClient(options)
  return {
    async calculate(plan, signal) {
      const response = await http.post(options.endpoint ?? '/api/v1/routes', encodeRouteRequest(plan), signal)
      return decodeRouteResponse(response)
    },
  }
}
