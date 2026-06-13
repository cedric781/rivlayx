export type ProviderErrorCode =
  | 'INVALID_REFERENCE'
  | 'UNSUPPORTED_PREDICATE'
  | 'NETWORK_ERROR'
  | 'NOT_FOUND'
  | 'MALFORMED_RESPONSE'
  | 'NO_PROVIDER_FOR_PREDICATE'
  | 'NO_HTTP_CLIENT';

export class ProviderError extends Error {
  public readonly code: ProviderErrorCode;
  public readonly details?: Record<string, unknown>;
  constructor(code: ProviderErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.name = 'ProviderError';
    if (details) this.details = details;
  }
}
