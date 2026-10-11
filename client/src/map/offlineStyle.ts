import type { StyleSpecification } from 'maplibre-gl'

// Exact geographic reference grid, not fabricated roads or an approximate basemap.
// Keeps the planner functional without a tile provider, credentials or network access.
export function offlineStyle(): StyleSpecification {
  const lines: [number, number][][] = []
  for (let longitude = 23; longitude <= 28; longitude += 0.1) lines.push([[longitude, 59.5], [longitude, 62]])
  for (let latitude = 59.5; latitude <= 62; latitude += 0.1) lines.push([[23, latitude], [28, latitude]])
  return {
    version: 8,
    sources: { grid: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } } } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#edf2f3' } },
      { id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': '#c9d5da', 'line-width': 1, 'line-opacity': 0.6, 'line-dasharray': [2, 5] } },
    ],
  }
}
