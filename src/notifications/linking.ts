/**
 * Notification deep links are allowlisted on the server when written and again here on tap.
 * Keep the patterns in lockstep with backend/src/notifications/domain/deepLinks.ts.
 */
export const NOTIFICATIONS_HREF = '/notifications';

/** Release A gate; inlined by Expo at build time. */
export function notificationsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_NOTIFICATIONS_ENABLED === 'true';
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const ALLOWED: RegExp[] = [
  new RegExp(`^/collection/${UUID}$`),
  /^\/creator\/[a-z0-9._]{3,30}$/,
  new RegExp(`^/\\(tabs\\)/create/review\\?ingestId=${UUID}$`),
  /^\/settings$/,
  /^\/analytics$/,
  /^\/notifications$/,
];

export function isAllowedNotificationLink(link: string | null | undefined): link is string {
  return typeof link === 'string' && ALLOWED.some((re) => re.test(link));
}

/** Where a tap should go; unknown or missing links stay in the inbox. */
export function resolveNotificationHref(link: string | null | undefined): string {
  return isAllowedNotificationLink(link) ? link : NOTIFICATIONS_HREF;
}
