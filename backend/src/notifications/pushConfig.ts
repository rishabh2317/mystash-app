import { getEnv } from '../env';

export class PushConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushConfigError';
  }
}

export type PushConfig = { enabled: false } | { enabled: true; expoAccessToken: string };

/** Push is off unless NOTIFICATIONS_PUSH_ENABLED is exactly "true". */
export function notificationPushEnabled(env: (key: string) => string | undefined = getEnv): boolean {
  return env('NOTIFICATIONS_PUSH_ENABLED') === 'true';
}

/**
 * Enhanced push security is required from day one: with push enabled, a missing
 * EXPO_ACCESS_TOKEN is a startup error, never a silent unauthenticated sender.
 */
export function resolvePushConfig(env: (key: string) => string | undefined = getEnv): PushConfig {
  if (!notificationPushEnabled(env)) return { enabled: false };
  const token = env('EXPO_ACCESS_TOKEN')?.trim();
  if (!token) {
    throw new PushConfigError('NOTIFICATIONS_PUSH_ENABLED=true requires EXPO_ACCESS_TOKEN (Expo enhanced push security)');
  }
  return { enabled: true, expoAccessToken: token };
}
