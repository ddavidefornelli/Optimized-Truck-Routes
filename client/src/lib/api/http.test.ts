import { afterEach, expect, it, vi } from 'vitest'
import { createHttpClient } from './http'

afterEach(() => vi.useRealTimers())

it('posts JSON to the configured origin and endpoint', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'no_route' })))
  const http = createHttpClient({ baseUrl: 'https://routing.example/', fetch: fetcher })
  expect(await http.post('/api/v1/routes', { origin: {} }, new AbortController().signal)).toEqual({ status: 'no_route' })
  expect(fetcher).toHaveBeenCalledWith('https://routing.example/api/v1/routes', expect.objectContaining({ method: 'POST', body: '{"origin":{}}', headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }))
})

it.each([422, 429, 500, 503])('distinguishes HTTP %s from a connection failure', async (status) => {
  const http = createHttpClient({ fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status })) })
  await expect(http.post('/api/v1/routes', {}, new AbortController().signal)).rejects.toMatchObject({ code: `http_${status}` })
})

it('reports unreadable JSON', async () => {
  const http = createHttpClient({ fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('<html />')) })
  await expect(http.post('/api/v1/routes', {}, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_response' })
})

it('reports an unreachable backend without returning demo data', async () => {
  const http = createHttpClient({ fetch: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')) })
  await expect(http.post('/api/v1/routes', {}, new AbortController().signal)).rejects.toMatchObject({ code: 'network' })
})

const abortableFetch = () => vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
  options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
}))

it('aborts overdue requests and reports a timeout', async () => {
  vi.useFakeTimers()
  const http = createHttpClient({ timeoutMs: 100, fetch: abortableFetch() })
  const promise = expect(http.post('/api/v1/routes', {}, new AbortController().signal)).rejects.toMatchObject({ code: 'timeout' })
  await vi.advanceTimersByTimeAsync(101)
  await promise
})

it('propagates user cancellation instead of presenting it as a server failure', async () => {
  const controller = new AbortController()
  const http = createHttpClient({ fetch: abortableFetch() })
  const promise = http.post('/api/v1/routes', {}, controller.signal)
  controller.abort()
  await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
})
