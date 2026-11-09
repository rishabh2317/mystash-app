export type CreatorDateRange = { start: string; end: string };

const DAY = 86400000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function utcDay(value: string): number | null {
  if (!ISO_DAY.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

export function shiftUtcDay(value: string, days: number): string {
  const time = utcDay(value);
  if (time === null) throw new Error('Invalid date');
  return new Date(time + days * DAY).toISOString().slice(0, 10);
}

export function lastCompleteUtcDay(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY).toISOString().slice(0, 10);
}

/** The UI uses inclusive days; the reporting API uses a UTC-exclusive end. */
export function validateCreatorDateRange(range: CreatorDateRange, today = new Date()): string | null {
  const start = utcDay(range.start), end = utcDay(range.end), last = utcDay(lastCompleteUtcDay(today))!;
  if (start === null || end === null) return 'Choose valid dates.';
  if (start > end) return 'The end date must be on or after the start date.';
  if (end > last) return 'Choose a completed day, before today.';
  if ((end - start) / DAY + 1 > 90) return 'Choose up to 90 days.';
  return null;
}

export function creatorRangeDays(range: CreatorDateRange): number {
  const start = utcDay(range.start), end = utcDay(range.end);
  if (start === null || end === null) throw new Error('Invalid date range');
  return (end - start) / DAY + 1;
}
