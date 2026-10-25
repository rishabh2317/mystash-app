import { outcome, type PushOutcome } from './types';

/** Errors that prove the request never reached the provider. */
const CONNECT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
]);

function errorCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function isAbort(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Connect-phase failures are retryable: the provider cannot have received anything.
 * Anything after the body may have been written (timeout, reset, our own abort) is ambiguous.
 */
export function classifyTransportError(err: unknown, phase: 'connect' | 'after_write'): PushOutcome {
  const code = errorCode(err);
  const message = (err as { message?: unknown } | null)?.message;
  if (code && CONNECT_CODES.has(code)) {
    return outcome('retryable', 'network_unreachable', { providerCode: code, providerMessage: message as string });
  }
  if (phase === 'connect' && !isAbort(err)) {
    return outcome('retryable', 'network_unreachable', { providerCode: code, providerMessage: message as string });
  }
  if (isAbort(err)) {
    return outcome('ambiguous', 'timeout_after_send', { providerCode: code ?? 'ABORTED', providerMessage: message as string });
  }
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') {
    return outcome('ambiguous', 'connection_reset', { providerCode: code, providerMessage: message as string });
  }
  return outcome('ambiguous', 'unknown', { providerCode: code, providerMessage: message as string });
}
