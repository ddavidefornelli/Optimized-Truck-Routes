import type { RouteResult, RouteService } from './domain'
import { createPlan, sameCoordinates } from './domain'
import { RouteServiceError } from '../../lib/api/http'

export const demoPlan = createPlan(
  { latitude: 60.1699, longitude: 24.9384 },
  { latitude: 60.3929, longitude: 25.6639 },
)

// Synthetic illustration, NOT a road network or an actual truck-compatible route.
// It is never used as an automatic fallback for a failed API request.
export const demoResult: RouteResult = {
  status: 'ok', mode: 'demo', vehicle: null,
  warnings: ['Percorso sintetico: non segue una rete stradale e non verifica le restrizioni dei camion. Non utilizzarlo per la guida.'],
  routes: [{
    id: 'demo-balanced', name: 'Esempio di percorso', distanceMeters: 58_400, durationSeconds: 3_120,
    warnings: [],
    geometry: {
      type: 'LineString',
      coordinates: [[24.9384, 60.1699], [24.96, 60.21], [25.04, 60.245], [25.12, 60.264], [25.23, 60.28], [25.34, 60.307], [25.45, 60.325], [25.55, 60.357], [25.6639, 60.3929]],
    },
  }],
}

export function createDemoRouteService(): RouteService {
  return {
    async calculate(plan, signal) {
      if (signal.aborted) throw new DOMException('Annullato', 'AbortError')
      if (plan.stops.length !== 2 || !plan.stops.every((stop, index) => sameCoordinates(stop.coordinates, demoPlan.stops[index].coordinates))) {
        throw new RouteServiceError('La demo è disponibile solo per i due punti di esempio.', 'demo_points')
      }
      return structuredClone(demoResult)
    },
  }
}
