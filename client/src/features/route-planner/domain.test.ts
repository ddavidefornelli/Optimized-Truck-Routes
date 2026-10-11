import { describe, expect, it } from 'vitest'
import { createPlan, formatCoordinates, formatDistance, formatDuration, parseCoordinates } from './domain'

describe('coordinate input', () => {
  it('parses latitude, longitude into named coordinates, not GeoJSON order', () => {
    expect(parseCoordinates(' 60.16990, 24.93840 ')).toEqual({ latitude: 60.1699, longitude: 24.9384 })
    expect(parseCoordinates('0, 0')).toEqual({ latitude: 0, longitude: 0 })
    expect(parseCoordinates('-90, -180')).toEqual({ latitude: -90, longitude: -180 })
  })
  it.each(['', 'Helsinki', '60,1699, 24,9384', '91, 24', '60, 181', 'NaN, 12', '60,', '60 24', 'Infinity, 12'])('rejects invalid input: %s', (value) => {
    expect(parseCoordinates(value)).toBeNull()
  })
  it('formats points and stores an ordered itinerary', () => {
    const point = { latitude: 60.1699, longitude: 24.9384 }
    expect(formatCoordinates(point)).toBe('60.16990, 24.93840')
    expect(createPlan(point, { latitude: 60.3929, longitude: 25.6639 }).stops.map((stop) => stop.kind)).toEqual(['origin', 'delivery'])
  })
})

it('formats metrics without pretending missing values are zero', () => {
  expect(formatDistance(58_400)).toBe('58,4 km')
  expect(formatDuration(3_120)).toBe('52 min')
  expect(formatDuration(3_660)).toBe('1 h 1 min')
  expect(formatDistance(null)).toBe('Ei saatavilla')
  expect(formatDuration(null)).toBe('Ei saatavilla')
  expect(formatDistance(58_400, 'en-GB')).toBe('58.4 km')
})
