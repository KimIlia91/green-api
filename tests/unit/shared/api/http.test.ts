import { afterEach, describe, expect, it, vi } from 'vitest'

import { GreenApiError } from '@/shared/api/errors.ts'
import { sendHttpRequest } from '@/shared/api/http.ts'

const url = new URL(
  'https://3100.api.green-api.com/waInstance1/getStateInstance/abc123',
)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sendHttpRequest', () => {
  it('returns JSON from a successful response', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ stateInstance: 'authorized' }))

    const body = await sendHttpRequest({
      url,
      method: 'GET',
      timeoutMs: 1000,
      fetchImpl,
    })

    expect(body).toEqual({
      kind: 'json',
      value: { stateInstance: 'authorized' },
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('reports an HTTP error with a JSON body', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'Validation failed' }, 400))

    const error = await sendHttpRequest({
      url,
      method: 'POST',
      jsonBody: { message: 'hello' },
      timeoutMs: 1000,
      fetchImpl,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GreenApiError)
    expect(error).toMatchObject({
      kind: 'http',
      status: 400,
      message: 'HTTP 400',
      responseBody: { message: 'Validation failed' },
    })
    expect(error instanceof GreenApiError ? error.message : '').not.toContain(
      'abc123',
    )
  })

  it('reports an HTTP error with a plain text body', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('Bad gateway', {
        status: 502,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    await expect(
      sendHttpRequest({ url, method: 'GET', timeoutMs: 1000, fetchImpl }),
    ).rejects.toMatchObject({
      kind: 'http',
      status: 502,
      responseBody: 'Bad gateway',
    })
  })

  it('rejects a successful response whose JSON cannot be parsed', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(
      sendHttpRequest({ url, method: 'GET', timeoutMs: 1000, fetchImpl }),
    ).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('times out and does not keep the abort listener', async () => {
    const external = new AbortController()
    const fetchImpl = hangingFetch()

    const pending = sendHttpRequest({
      url,
      method: 'GET',
      timeoutMs: 20,
      signal: external.signal,
      fetchImpl,
    })

    await expect(pending).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('uses the caller abort signal instead of a timeout', async () => {
    const external = new AbortController()
    const fetchImpl = hangingFetch()
    const pending = sendHttpRequest({
      url,
      method: 'GET',
      timeoutMs: 5_000,
      signal: external.signal,
      fetchImpl,
    })

    external.abort()

    await expect(pending).rejects.toMatchObject({
      kind: 'abort',
      message: 'Request was cancelled',
    })
  })

  it('does not call fetch when the caller signal is already aborted', async () => {
    const external = new AbortController()
    external.abort()
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      sendHttpRequest({
        url,
        method: 'GET',
        timeoutMs: 1000,
        signal: external.signal,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ kind: 'abort' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('hides the request URL when the network fails', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError(`Failed to fetch ${url.href}`))

    const error = await sendHttpRequest({
      url,
      method: 'GET',
      timeoutMs: 1000,
      fetchImpl,
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      kind: 'network',
      message: 'Network request failed',
    })
    expect(error instanceof Error ? error.message : '').not.toContain('abc123')
    expect(error instanceof Error ? error.message : '').not.toContain(
      'green-api.com',
    )
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function hangingFetch(): typeof fetch {
  return vi.fn<typeof fetch>((_input, init) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) {
        reject(new Error('missing signal'))
        return
      }
      if (signal.aborted) {
        reject(abortError())
        return
      }
      signal.addEventListener('abort', () => {
        reject(abortError())
      })
    })
  })
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError')
}
