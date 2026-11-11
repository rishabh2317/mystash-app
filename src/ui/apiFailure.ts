export type ApiFailureKind = 'connection' | 'timeout' | 'service' | 'rateLimit' | 'session' | 'permission' | 'missing' | 'unknown';
export const API_FAILURE_COPY = {
  connection: { title: 'Couldn’t connect', message: 'Check your connection and try again.' },
  timeout: { title: 'This is taking longer than expected', message: 'The request took too long. Please try again.' },
  service: { title: 'Mystash is temporarily unavailable', message: 'We’re having trouble reaching Mystash. Please try again shortly.' },
  rateLimit: { title: 'Let’s give it a moment', message: 'Too many requests. Wait a little before trying again.' },
  session: { title: 'Sign in to continue', message: 'Your session may have expired. Sign in and try again.' },
  permission: { title: 'Access unavailable', message: 'Your account doesn’t have access to this right now.' },
  missing: { title: 'No longer available', message: 'This item may have been removed or is no longer shared.' },
  unknown: { title: 'Something went wrong', message: 'We couldn’t complete that request. Please try again.' },
} as const;

/** Presentation only: keep transport errors/statuses intact for routing and recovery. */
export function apiFailure(error: unknown): { kind: ApiFailureKind; title: string; message: string } {
  const value = error && typeof error === 'object' ? error as { statusCode?: unknown; status?: unknown; message?: unknown; name?: unknown } : null;
  const raw = typeof error === 'string' ? error : typeof value?.message === 'string' ? value.message : '';
  const statusValue = value?.statusCode ?? value?.status;
  const embedded = /(?:\bHTTP\b|\bstatus\b|\bAPI\b|\brequest\b|\bfailed\b|\berror\b)[^\n]{0,50}?\b([45]\d{2})\b/i.exec(raw)?.[1];
  const status = typeof statusValue === 'number' ? statusValue : Number(embedded);
  let kind: ApiFailureKind = 'unknown';
  if (status === 408 || status === 504 || /timed?\s*out|timeout|AbortError|TimeoutError/i.test(`${value?.name ?? ''} ${raw}`)) kind = 'timeout';
  else if ((status >= 500 && status <= 599) || /bad gateway|service unavailable|internal server error|upstream.*(?:error|unavailable)/i.test(raw)) kind = 'service';
  else if (status === 429) kind = 'rateLimit';
  else if (status === 401) kind = 'session';
  else if (status === 403) kind = 'permission';
  else if (status === 404) kind = 'missing';
  else if (/network request failed|failed to fetch|networkerror|offline|econn|enotfound|socket|couldn.t reach|cannot connect|unable to reach/i.test(raw)) kind = 'connection';
  else {
    const canonical = (Object.keys(API_FAILURE_COPY) as ApiFailureKind[]).find(key => raw === API_FAILURE_COPY[key].message || raw === API_FAILURE_COPY[key].title);
    if (canonical) kind = canonical;
  }
  const copy = API_FAILURE_COPY[kind];
  // Preserve useful validation/recovery guidance, never HTML, infrastructure
  // diagnostics, credentials, signed capabilities, stack traces or SQL errors.
  const technical = /<\/?(?:html|body|head)|<!doctype|\b(?:SQLSTATE|PGRST\d*|TypeError|ReferenceError|postgres|redis|bullmq|stack trace|row.level security|violates.*constraint|service.role|API|HTTP)\b|permission denied for|cannot read propert|invalid json|not configured|\b(?:token|apikey|api_key|signature|password)=|\n\s*at\s/i.test(`${raw} ${value?.name ?? ''}`) || /\b[A-Z]+_[A-Z_]+\b/.test(raw);
  const message = kind === 'unknown' && raw.trim() && raw.length <= 500 && !technical ? raw.trim() : copy.message;
  return { kind, title: copy.title, message };
}

export const apiFailureMessage = (error: unknown) => apiFailure(error).message;
