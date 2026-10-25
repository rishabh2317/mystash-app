import type { NotificationItem, UnreadCount } from '@/src/services/notificationsApi';

export const NOTIFICATIONS_COPY = {
  title: 'Notifications',
  settingsRow: 'Notifications',
  settingsRowHint: 'Updates about your drafts, Collections and account',
  prefsRow: 'Notification settings',
  prefsRowHint: 'Choose what appears in your inbox and on this device',
  prefsTitle: 'Notification settings',
  prefsSocial: 'Follows, saves and likes',
  prefsSocialHint: 'When someone follows you or interacts with your work',
  prefsSocialInbox: 'Show in inbox',
  prefsSocialPush: 'Notify on this device',
  prefsTask: 'Drafts and Collections',
  prefsTaskHint: 'Always shown in your inbox. You can turn off device alerts.',
  prefsTaskPush: 'Notify on this device',
  prefsAccount: 'Account',
  prefsAccountHint: 'Always shown in your inbox. You can turn off device alerts.',
  prefsAccountPush: 'Notify on this device',
  prefsPromo: 'News and offers',
  prefsPromoHint: 'Occasional product news. Off until you opt in.',
  prefsPromoInbox: 'Show in inbox',
  prefsPromoPush: 'Notify on this device',
  prefsQuiet: 'Quiet hours',
  prefsQuietHint: 'Hold device alerts until this window ends. Inbox is unchanged.',
  prefsQuietStart: 'From',
  prefsQuietEnd: 'Until',
  prefsQuietInvalid: 'Use 24-hour times such as 22:00.',
  prefsLoadError: 'Couldn’t load notification settings.',
  prefsSaveError: 'Couldn’t save that setting.',
  markAllRead: 'Mark all read',
  emptyTitle: 'You’re all caught up',
  emptyBody: 'Updates about your drafts, Collections, follows and connected accounts will appear here.',
  signIn: 'Sign in to see your notifications.',
  errorTitle: 'Couldn’t load notifications',
  retry: 'Retry',
  unavailable: 'Notifications aren’t available yet.',
  today: 'Today',
  thisWeek: 'This week',
  earlier: 'Earlier',
  bellLabel: (unread: UnreadCount) =>
    unread.unread > 0 ? `Notifications, ${unreadBadgeLabel(unread)} unread` : 'Notifications',
} as const;

/** Push copy (Release B). Promises nothing about delivery: push is best effort. */
export const PUSH_COPY = {
  explainerTitle: 'Turn on notifications?',
  explainerBody: {
    first_publish: 'Get a heads-up when a draft is ready to review, a Collection goes live, or something needs your attention.',
    first_follow: 'Get a heads-up about your drafts, Collections and account, even when Mystash is closed.',
  },
  explainerAccept: 'Turn on',
  explainerDecline: 'Not now',
  settingsRow: 'Push notifications',
  settingsOn: 'On',
  settingsOff: 'Off',
  settingsBlocked: 'Off in device settings',
} as const;

export function pushSettingsValue(permission: 'granted' | 'provisional' | 'denied' | 'undetermined'): string {
  if (permission === 'granted' || permission === 'provisional') return PUSH_COPY.settingsOn;
  return permission === 'denied' ? PUSH_COPY.settingsBlocked : PUSH_COPY.settingsOff;
}

/** Unread polling cadence while the app is in the foreground. */
export const UNREAD_POLL_MS = 60_000;
export const NOTIFICATIONS_PAGE_SIZE = 20;

export function unreadBadgeLabel(count: UnreadCount): string {
  if (count.unread <= 0) return '';
  return count.capped || count.unread > 99 ? '99+' : String(count.unread);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact relative time: "now", "5m", "3h", "2d", then a short date. */
export function formatNotificationTime(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const delta = Math.max(0, now - at);
  if (delta < MINUTE) return 'now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d`;
  const d = new Date(at);
  const month = d.toLocaleString('en-US', { month: 'short' });
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear ? `${month} ${d.getDate()}` : `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

export type NotificationSection = { title: string; data: NotificationItem[] };

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Groups by the time the item last changed (aggregates move up when a new actor joins). */
export function sectionNotifications(items: NotificationItem[], now: number = Date.now()): NotificationSection[] {
  const today = startOfDay(now);
  const weekAgo = today - 6 * DAY;
  const buckets: Record<string, NotificationItem[]> = {
    [NOTIFICATIONS_COPY.today]: [],
    [NOTIFICATIONS_COPY.thisWeek]: [],
    [NOTIFICATIONS_COPY.earlier]: [],
  };
  for (const item of items) {
    const at = Date.parse(item.updatedAt);
    const key =
      at >= today ? NOTIFICATIONS_COPY.today : at >= weekAgo ? NOTIFICATIONS_COPY.thisWeek : NOTIFICATIONS_COPY.earlier;
    buckets[key].push(item);
  }
  return Object.entries(buckets)
    .filter(([, data]) => data.length > 0)
    .map(([title, data]) => ({ title, data }));
}

/** Appends a page, keeping server order and dropping ids already shown (aggregates can move). */
export function mergeNotificationPages(existing: NotificationItem[], next: NotificationItem[]): NotificationItem[] {
  const seen = new Set(existing.map((i) => i.id));
  return [...existing, ...next.filter((i) => !seen.has(i.id))];
}

export function markItemsReadLocally(items: NotificationItem[], ids: ReadonlySet<string> | 'all'): NotificationItem[] {
  return items.map((i) => (i.read || (ids !== 'all' && !ids.has(i.id)) ? i : { ...i, read: true, seen: true }));
}

type IconName =
  | 'person-add-outline'
  | 'bookmark-outline'
  | 'heart-outline'
  | 'checkmark-circle-outline'
  | 'alert-circle-outline'
  | 'sparkles-outline'
  | 'sync-outline'
  | 'link-outline'
  | 'ribbon-outline'
  | 'notifications-outline';

export function notificationIcon(type: string): IconName {
  switch (type) {
    case 'creator.followed':
      return 'person-add-outline';
    case 'collection.saved':
      return 'bookmark-outline';
    case 'reel.liked':
      return 'heart-outline';
    case 'collection.publish_succeeded':
      return 'checkmark-circle-outline';
    case 'collection.publish_failed':
    case 'ingest.failed':
      return 'alert-circle-outline';
    case 'ingest.ready_for_review':
      return 'sparkles-outline';
    case 'creator_library.sync_failed':
      return 'sync-outline';
    case 'connected_account.needs_reauth':
      return 'link-outline';
    case 'creator.status_changed':
      return 'ribbon-outline';
    case 'promo.broadcast':
      return 'sparkles-outline';
    default:
      return 'notifications-outline';
  }
}

/** Social rows show the first visible actor's photo; everything else shows the type icon. */
export function notificationAvatarUrl(item: NotificationItem): string | null {
  if (item.category !== 'social') return null;
  return item.actors.find((a) => a.profilePhotoUrl)?.profilePhotoUrl ?? null;
}
