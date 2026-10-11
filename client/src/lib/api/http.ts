export class RouteServiceError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'RouteServiceError'
    this.code = code
  }
}

interface HttpOptions {
  baseUrl?: string
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
}

export function createHttpClient(options: HttpOptions = {}) {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
  const fetcher = options.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args))

  return {
    async post(path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
      const controller = new AbortController()
      let timedOut = false
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) controller.abort()
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, options.timeoutMs ?? 20_000)

      try {
        const response = await fetcher(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!response.ok) {
          const messages: Record<number, string> = {
            400: 'Il backend non ha accettato la richiesta. Controlla i punti inseriti.',
            422: 'I dati non sono validi per il backend. Controlla coordinate e contratto API.',
            429: 'Troppe richieste. Attendi un momento e riprova.',
            503: 'Il motore di routing non è ancora pronto. Riprova più tardi.',
          }
          throw new RouteServiceError(messages[response.status] ?? 'Non è stato possibile calcolare il percorso. Riprova.', `http_${response.status}`)
        }
        try {
          return await response.json()
        } catch (error) {
          if (controller.signal.aborted) throw error
          throw new RouteServiceError('Il backend ha restituito una risposta non leggibile.', 'invalid_response')
        }
      } catch (error) {
        if (signal.aborted) throw new DOMException('Richiesta annullata', 'AbortError')
        if (timedOut) throw new RouteServiceError('Il calcolo sta impiegando troppo tempo. Riprova.', 'timeout')
        if (error instanceof RouteServiceError) throw error
        throw new RouteServiceError('Backend non raggiungibile. Verifica che il server sia avviato oppure prova la demo.', 'network')
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
      }
    },
  }
}
