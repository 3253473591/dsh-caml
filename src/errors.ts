/** Structured error carried across plugin boundaries; `code` is stable and assertable. */
export interface CamlErrorOptions {
  retryable?: boolean
  hint?: string
  details?: unknown
}

export class CamlError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly hint: string | undefined
  readonly details: unknown

  constructor(code: string, message: string, options: CamlErrorOptions = {}) {
    super(message)
    this.name = 'CamlError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.hint = options.hint
    this.details = options.details
  }
}

export function isCamlError(error: unknown): error is CamlError {
  return error instanceof CamlError
}
