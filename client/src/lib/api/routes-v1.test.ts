import { describe, expect, it } from 'vitest'
import { decodeRouteResponse, encodeRouteRequest } from './routes-v1'
import { demoPlan } from '../../features/route-planner/demo'

const wireRoute = { id: 'r-1', profiles: ['balanced'], geometry: { type: 'LineString', coordinates: [[24.9384, 60.1699], [25.6639, 60.3929]] }, distance_m: 58_400, duration_s: 3_120 }

it('encodes the current API contract without vehicle parameters or UI stop IDs', () => {
  expect(encodeRouteRequest(demoPlan)).toEqual({
    origin: { latitude: 60.1699, longitude: 24.9384 }, destination: { latitude: 60.3929, longitude: 25.6639 },
    profiles: ['balanced'], preferences: { unpaved: 'avoid', narrow_roads: 'avoid', urban_areas: 'avoid', tight_curves: 'avoid', unlit_at_night: 'avoid', unknown_critical_restrictions: 'warn' },
  })
})

it('rejects additional deliveries rather than silently omitting them', () => {
  expect(() => encodeRouteRequest({ stops: [...demoPlan.stops, { id: 'next', kind: 'delivery', coordinates: { latitude: 61, longitude: 25 } }] })).toThrow('una sola consegna')
})

it('validates coordinates independently of the form', () => {
  expect(() => encodeRouteRequest({ stops: [demoPlan.stops[0], { ...demoPlan.stops[1], coordinates: demoPlan.stops[0].coordinates }] })).toThrow('distinti')
  expect(() => encodeRouteRequest({ stops: [demoPlan.stops[0], { ...demoPlan.stops[1], coordinates: { latitude: NaN, longitude: 181 } }] })).toThrow('validi')
})

describe('runtime response boundary', () => {
  it('normalizes known fields and ignores additive changes', () => {
    const result = decodeRouteResponse({ status: 'ok', mode: 'real', routes: [{ ...wireRoute, future_field: true }], future_metadata: {}, vehicle_profile: { id: 'standard', version: '1', height_m: 4, mass_kg: 32_000 } })
    expect(result.routes[0]).toMatchObject({ id: 'r-1', name: 'Bilanciato', distanceMeters: 58_400, durationSeconds: 3_120 })
    expect(result.vehicle).toMatchObject({ id: 'standard', heightMeters: 4, widthMeters: null, massKg: 32_000 })
  })
  it('supports Feature-wrapped and multipart GeoJSON', () => {
    const geometry = { type: 'MultiLineString', coordinates: [[[24, 60], [25, 61]], [[25, 61], [26, 62]]] }
    expect(decodeRouteResponse({ status: 'ok', mode: 'demo', routes: [{ ...wireRoute, geometry: { type: 'Feature', geometry, properties: {} } }] }).routes[0].geometry).toEqual(geometry)
  })
  it('does not invent missing metrics or data mode', () => {
    const result = decodeRouteResponse({ status: 'ok', routes: [{ id: 'r-1', geometry: wireRoute.geometry }] })
    expect(result.mode).toBe('unknown')
    expect(result.routes[0].distanceMeters).toBeNull()
    expect(result.routes[0].durationSeconds).toBeNull()
  })
  it('handles no_route without relaxing constraints', () => {
    expect(decodeRouteResponse({ status: 'no_route', mode: 'real', warnings: ['Fuori dal grafo disponibile.'] })).toMatchObject({ status: 'no_route', routes: [], warnings: ['Fuori dal grafo disponibile.'] })
  })
  it.each([
    null, { status: 'ok' }, { status: 'ok', routes: [] }, { status: 'unexpected', routes: [] },
    { status: 'no_route', routes: [wireRoute] }, { status: 'ok', mode: 'certified', routes: [wireRoute] },
    { status: 'ok', routes: [{ ...wireRoute, distance_m: -1 }] },
    { status: 'ok', routes: [{ ...wireRoute, duration_s: '3120' }] },
    { status: 'ok', routes: [{ ...wireRoute, geometry: { type: 'LineString', coordinates: [[181, 60], [25, 61]] } }] },
    { status: 'ok', routes: [{ ...wireRoute, geometry: { type: 'Point', coordinates: [24, 60] } }] },
    { status: 'ok', routes: [{ ...wireRoute, warnings: [{}] }] },
    { status: 'ok', routes: [wireRoute, wireRoute] },
  ])('rejects incompatible responses: %j', (input) => {
    expect(() => decodeRouteResponse(input)).toThrow('contratto di routing')
  })
})
