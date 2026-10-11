import type { AddressSearch, AddressSuggestion } from '../../features/route-planner/address'

// Provider JSON stays in this adapter, not in components or routing contracts.
interface GeoapifyFeature {
  properties?: { place_id?: unknown; formatted?: unknown; lat?: unknown; lon?: unknown }
}

export function createGeoapifySearch(apiKey: string, fetcher: typeof fetch = fetch): AddressSearch {
  return {
    async search(text, signal) {
      const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete')
      url.search = new URLSearchParams({ text, apiKey, lang: 'it', limit: '5', filter: 'countrycode:fi' }).toString()
      const response = await fetcher(url, { signal })
      if (!response.ok) throw new Error('Ricerca non disponibile. Riprova o scegli sulla mappa.')
      const data: unknown = await response.json()
      if (!data || typeof data !== 'object' || !('features' in data) || !Array.isArray(data.features)) {
        throw new Error('Risposta di ricerca non valida.')
      }
      const suggestions: AddressSuggestion[] = []
      for (const feature of data.features as GeoapifyFeature[]) {
        const p = feature?.properties
        if (!p || typeof p.formatted !== 'string' || !p.formatted.trim() ||
          typeof p.lat !== 'number' || !Number.isFinite(p.lat) || Math.abs(p.lat) > 90 ||
          typeof p.lon !== 'number' || !Number.isFinite(p.lon) || Math.abs(p.lon) > 180) continue
        suggestions.push({
          id: typeof p.place_id === 'string' ? p.place_id : `${p.lat},${p.lon}:${p.formatted}`,
          label: p.formatted,
          coordinates: { latitude: p.lat, longitude: p.lon },
        })
      }
      return suggestions
    },
  }
}
