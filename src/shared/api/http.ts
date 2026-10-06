import { GreenApiError } from './errors.ts'

export type HttpMethod = 'GET' | 'POST' | 'DELETE'

export type HttpResponseBody =
  | { kind: 'empty' }
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; value: string }

export type HttpRequest = {
  url: URL
  method: HttpMethod
  jsonBody?: unknown
  timeoutMs: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

type LinkedAbort = {
  signal: AbortSignal
  outcome: () => 'abort' | 'timeout' | null
  dispose: () => void
}

export async function sendHttpRequest(
  request: HttpRequest,
): Promise<HttpResponseBody> {
  const linked = linkAbort(request.timeoutMs, request.signal)

  try {
    if (linked.outcome() === 'abort') {
      throw new GreenApiError('abort', 'Request was cancelled')
    }

    const fetchImpl = request.fetchImpl ?? globalThis.fetch
    const response = await fetchImpl(request.url, {
      method: request.method,
      mode: 'cors',
      credentials: 'omit',
      headers:
        request.jsonBody === undefined
          ? undefined
          : { 'Content-Type': 'application/json' },
      body:
        request.jsonBody === undefined
          ? undefined
          : JSON.stringify(request.jsonBody),
      signal: linked.signal,
    })

    return await readResponse(response)
  } catch (error) {
    if (error instanceof GreenApiError) {
      throw error
    }

    const outcome = linked.outcome()
    if (outcome === 'abort') {
      throw new GreenApiError('abort', 'Request was cancelled')
    }
    if (outcome === 'timeout') {
      throw new GreenApiError('timeout', 'Request timed out')
    }

    throw new GreenApiError('network', 'Network request failed')
  } finally {
    linked.dispose()
  }
}

function linkAbort(timeoutMs: number, external?: AbortSignal): LinkedAbort {
  const controller = new AbortController()
  let timedOut = false

  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const onExternalAbort = () => {
    controller.abort()
  }

  if (external?.aborted) {
    controller.abort()
  } else {
    external?.addEventListener('abort', onExternalAbort)
  }

  return {
    signal: controller.signal,
    outcome: () => {
      if (external?.aborted) {
        return 'abort'
      }
      if (timedOut) {
        return 'timeout'
      }
      return null
    },
    dispose: () => {
      clearTimeout(timeoutId)
      external?.removeEventListener('abort', onExternalAbort)
    },
  }
}

async function readResponse(response: Response): Promise<HttpResponseBody> {
  const text = await response.text()
  const body = classifyBody(text, response.headers.get('content-type'))

  if (!response.ok) {
    throw new GreenApiError('http', `HTTP ${String(response.status)}`, {
      status: response.status,
      responseBody:
        body.kind === 'json'
          ? body.value
          : body.kind === 'text'
            ? body.text
            : null,
    })
  }

  if (body.kind === 'unparseable') {
    throw new GreenApiError(
      'invalid-response',
      'Response JSON could not be parsed',
    )
  }

  if (body.kind === 'empty') {
    return { kind: 'empty' }
  }

  if (body.kind === 'text') {
    return { kind: 'text', value: body.text }
  }

  return { kind: 'json', value: body.value }
}

type ClassifiedBody =
  | { kind: 'empty' }
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; text: string }
  | { kind: 'unparseable' }

function classifyBody(
  text: string,
  contentType: string | null,
): ClassifiedBody {
  if (text.trim() === '') {
    return { kind: 'empty' }
  }

  if ((contentType ?? '').toLowerCase().includes('json')) {
    try {
      return { kind: 'json', value: JSON.parse(text) as unknown }
    } catch {
      return { kind: 'unparseable' }
    }
  }

  return { kind: 'text', text }
}
