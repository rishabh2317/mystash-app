/**
 * Structured client logs for the curation pipeline.
 * - __DEV__: verbose info for Metro / Flipper / Xcode console.
 * - Production: warn/error only (no PII: never log full URLs, only host).
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

function safeHost(url: string): string | undefined {
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return undefined;
  }
}

export function curationLog(
  level: Level,
  event: string,
  fields?: Record<string, string | number | boolean | null | undefined>,
): void {
  const payload = { svc: 'curation-client', event, ...fields };
  const line = `[Mystash:Curation] ${JSON.stringify(payload)}`;
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  if (__DEV__) {
    console.log(line);
  }
}

export function curationLogIngestStart(sourceUrl: string): void {
  curationLog('info', 'ingest.submit.start', { sourceHost: safeHost(sourceUrl) });
}

export function curationLogIngestResult(fields: {
  ok: boolean;
  ingestId?: string;
  status?: string;
  extractionSource?: string;
  extractionStatus?: string;
  extractionDurationMs?: number;
  traceId?: string;
  extractionErrorCode?: string;
  error?: string;
}): void {
  if (!fields.ok) {
    curationLog('error', 'ingest.submit.failed', {
      status: fields.status,
      error: fields.error?.slice(0, 400),
    });
    return;
  }
  curationLog('info', 'ingest.submit.ok', {
    ingestId: fields.ingestId,
    status: fields.status,
    extractionSource: fields.extractionSource,
    extractionStatus: fields.extractionStatus,
    extractionDurationMs: fields.extractionDurationMs,
    traceId: fields.traceId,
    extractionErrorCode: fields.extractionErrorCode,
  });
}
