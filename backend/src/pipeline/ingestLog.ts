import { logger } from '../logger';

export type IngestLogFields = Record<string, string | number | boolean | null | undefined>;

/** Structured logs (JSON) + pino fields for grep in terminal. */
export function ingestLog(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: IngestLogFields = {},
): void {
  const payload = { svc: 'ingest-pipeline', event, ...fields };
  if (level === 'error') logger.error(payload);
  else if (level === 'warn') logger.warn(payload);
  else logger.info(payload);
}
