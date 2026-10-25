import type { NotificationCategory, NotificationChannel } from './types';

export type PreferencePair = { category: NotificationCategory; channel: NotificationChannel };

export type PreferenceRow = PreferencePair & { enabled: boolean };

export type QuietHours = { start: string; end: string };

export type NotificationSettingsState = {
  preferences: (PreferenceRow & { configurable: true })[];
  timezone: string;
  quietHours: QuietHours | null;
  promoOptedIn: boolean;
};

/** Inbox for task/account and every security channel is always on; these are the rest. */
export const CONFIGURABLE_PAIRS: readonly PreferencePair[] = [
  { category: 'social', channel: 'inbox' },
  { category: 'social', channel: 'push' },
  { category: 'task', channel: 'push' },
  { category: 'account', channel: 'push' },
  { category: 'promo', channel: 'inbox' },
  { category: 'promo', channel: 'push' },
];

const PAIR_KEY = (p: PreferencePair) => `${p.category}:${p.channel}`;
const CONFIGURABLE_KEYS = new Set(CONFIGURABLE_PAIRS.map(PAIR_KEY));

export function isConfigurablePair(category: string, channel: string): boolean {
  return CONFIGURABLE_KEYS.has(`${category}:${channel}`);
}

/** Absent row = on, except promo push which stays off until an explicit opt-in. */
export function defaultEnabled(pair: PreferencePair): boolean {
  return !(pair.category === 'promo' && pair.channel === 'push');
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export function normalizeClock(value: string): string | null {
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}

export function isIanaTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return value.trim().length > 0 && !/^\s/.test(value);
  } catch {
    return false;
  }
}

export function resolveSettings(input: {
  stored: PreferenceRow[];
  timezone: string | null;
  quietHours: QuietHours | null;
  promoOptedIn: boolean;
}): NotificationSettingsState {
  const byKey = new Map(input.stored.map((row) => [PAIR_KEY(row), row.enabled]));
  return {
    preferences: CONFIGURABLE_PAIRS.map((pair) => ({
      ...pair,
      enabled: byKey.has(PAIR_KEY(pair)) ? Boolean(byKey.get(PAIR_KEY(pair))) : defaultEnabled(pair),
      configurable: true,
    })),
    timezone: input.timezone && isIanaTimeZone(input.timezone) ? input.timezone : 'UTC',
    quietHours: input.quietHours,
    promoOptedIn: input.promoOptedIn,
  };
}
