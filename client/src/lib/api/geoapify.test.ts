import { expect, it, vi } from 'vitest'
import { createGeoapifySearch } from './geoapify'

it('requests Finnish suggestions and converts valid provider results into domain coordinates', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ features: [
    { properties: { place_id: 'helsinki', formatted: 'Mannerheimintie 1, Helsinki', lat: 60.17, lon: 24.94 } },
    { properties: { formatted: 'Invalid', lat: 91, lon: 24 } },
    { properties: { formatted: 'Missing coordinates' } },
  ] })))
  const signal = new AbortController().signal
  const results = await createGeoapifySearch('test-key', fetcher).search('Mannerheimintie', signal)
  const [url, options] = fetcher.mock.calls[0]
  expect(new URL(String(url)).searchParams.get('lang')).toBe('fi')
  expect(new URL(String(url)).searchParams.get('filter')).toBe('countrycode:fi')
  expect(new URL(String(url)).searchParams.get('text')).toBe('Mannerheimintie')
  expect(options?.signal).toBe(signal)
  expect(results).toEqual([{ id: 'helsinki', label: 'Mannerheimintie 1, Helsinki', coordinates: { latitude: 60.17, longitude: 24.94 } }])
})

it('uses the selected language on every request', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ features: [] })))
  let selected: 'fi' | 'en' = 'fi'
  const service = createGeoapifySearch('test-key', fetcher, () => selected)
  await service.search('Helsinki', new AbortController().signal)
  selected = 'en'
  await service.search('Helsinki', new AbortController().signal)
  expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('lang'))).toEqual(['fi', 'en'])
})

it('reports HTTP and malformed responses without inventing suggestions', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('', { status: 429 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })))
  const service = createGeoapifySearch('test-key', fetcher)
  await expect(service.search('Helsinki', new AbortController().signal)).rejects.toThrow('Ricerca non disponibile')
  await expect(service.search('Helsinki', new AbortController().signal)).rejects.toThrow('Risposta di ricerca non valida')
})
