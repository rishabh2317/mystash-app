/** One-line JSON logs for Supabase Edge (Dashboard → Functions → Logs). Never log secrets or full JWTs. */

export type IngestLogFields = Record<string, string | number | boolean | null | undefined>;

export function ingestLog(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: IngestLogFields = {},
): void {
  const line = JSON.stringify({
    svc: 'ingest-pipeline',
    lvl: level,
    ts: new Date().toISOString(),
    event,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
