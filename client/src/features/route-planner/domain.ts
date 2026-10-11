// UI/domain types: deliberately independent of the backend's JSON contract.
export interface Coordinates {
  longitude: number
  latitude: number
}

export interface RouteStop {
  id: string
  kind: 'origin' | 'delivery'
  coordinates: Coordinates
}

// Ordered stops allow intermediate deliveries without redesigning the UI model.
export interface RoutePlan {
  stops: readonly RouteStop[]
}

export type RouteGeometry =
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'MultiLineString'; coordinates: [number, number][][] }

export interface RouteOption {
  id: string
  name: string
  geometry: RouteGeometry
  distanceMeters: number | null
  durationSeconds: number | null
  warnings: string[]
}

export interface VehicleSummary {
  id: string
  version: string
  heightMeters: number | null
  widthMeters: number | null
  lengthMeters: number | null
  massKg: number | null
}

export interface RouteResult {
  status: 'ok' | 'no_route'
  mode: 'demo' | 'real' | 'unknown'
  requestId?: string
  routes: RouteOption[]
  warnings: string[]
  vehicle: VehicleSummary | null
}

export interface RouteService {
  calculate(plan: RoutePlan, signal: AbortSignal): Promise<RouteResult>
}

export function parseCoordinates(text: string): Coordinates | null {
  const match = text.match(/^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*$/)
  if (!match) return null
  const latitude = Number(match[1])
  const longitude = Number(match[2])
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

export function formatCoordinates(point: Coordinates): string {
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`
}

export function sameCoordinates(a: Coordinates, b: Coordinates): boolean {
  return Math.abs(a.longitude - b.longitude) < 0.000001 && Math.abs(a.latitude - b.latitude) < 0.000001
}

export function createPlan(origin: Coordinates, destination: Coordinates): RoutePlan {
  return { stops: [
    { id: 'origin', kind: 'origin', coordinates: origin },
    { id: 'destination', kind: 'delivery', coordinates: destination },
  ] }
}

export function formatDistance(meters: number | null, locale = 'fi-FI', unavailable = 'Ei saatavilla'): string {
  const numbers = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  return meters === null ? unavailable : `${numbers.format(meters / 1000)} km`
}

export function formatDuration(seconds: number | null, unavailable = 'Ei saatavilla'): string {
  if (seconds === null) return unavailable
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min`
  const remainder = minutes % 60
  return `${Math.floor(minutes / 60)} h${remainder ? ` ${remainder} min` : ''}`
}
