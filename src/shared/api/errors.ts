export type GreenApiErrorKind =
  | 'abort'
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid-response'
  | 'invalid-connection'
  | 'invalid-request'

type GreenApiErrorOptions = {
  status?: number
  responseBody?: unknown
}

export class GreenApiError extends Error {
  readonly kind: GreenApiErrorKind
  readonly status: number | null
  readonly responseBody: unknown

  constructor(
    kind: GreenApiErrorKind,
    message: string,
    options: GreenApiErrorOptions = {},
  ) {
    super(message)
    this.name = 'GreenApiError'
    this.kind = kind
    this.status = options.status ?? null
    this.responseBody = options.responseBody ?? null
  }
}
