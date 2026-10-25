/**
 * Pure push rules (no native imports) so they are unit-testable under node.
 * Native wiring lives in pushRegistration.ts and PushNotificationsHost.tsx.
 */
import { NOTIFICATIONS_HREF, notificationsEnabled, resolveNotificationHref } from './linking';

/** Release B gate: push needs the inbox gate as well. Inlined by Expo at build time. */
export function pushEnabled(): boolean {
  return notificationsEnabled() && process.env.EXPO_PUBLIC_PUSH_ENABLED === 'true';
}

export type OsPermission = 'granted' | 'provisional' | 'denied' | 'undetermined';

/** iOS authorization status values from expo-notifications' IosAuthorizationStatus. */
const IOS_PROVISIONAL = 3;
const IOS_EPHEMERAL = 4;

export function mapOsPermission(
  status: 'granted' | 'denied' | 'undetermined' | string,
  iosStatus?: number | null,
): OsPermission {
  if (iosStatus === IOS_PROVISIONAL || iosStatus === IOS_EPHEMERAL) return 'provisional';
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

export function canReceivePush(permission: OsPermission): boolean {
  return permission === 'granted' || permission === 'provisional';
}

/** Re-register on launch and foreground at most once a day unless something changed. */
export const REGISTRATION_REFRESH_MS = 24 * 60 * 60 * 1000;

export type RegistrationSnapshot = {
  userId: string;
  installationId: string;
  token: string;
  osPermission: OsPermission;
  appVersion: string | null;
};

export type LastRegistration = RegistrationSnapshot & { at: number };

export function shouldRegister(
  last: LastRegistration | null,
  current: RegistrationSnapshot,
  now: number,
  force = false,
): boolean {
  if (force || !last) return true;
  return (
    last.userId !== current.userId ||
    last.installationId !== current.installationId ||
    last.token !== current.token ||
    last.osPermission !== current.osPermission ||
    last.appVersion !== current.appVersion ||
    now - last.at >= REGISTRATION_REFRESH_MS
  );
}

export type PromptTrigger = 'first_publish' | 'first_follow';

/**
 * Decision 8: ask only from a first publish / first follow, once, with an explainer first;
 * never at launch and never again after a denial (the OS also stops offering it).
 */
export function decidePrompt(input: {
  permission: OsPermission;
  canAskAgain: boolean;
  explainerShown: boolean;
}): 'ask' | 'skip' {
  if (input.permission !== 'undetermined') return 'skip';
  if (!input.canAskAgain || input.explainerShown) return 'skip';
  return 'ask';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DELIVERY_RE = /^[1-9][0-9]{0,18}$/;

/** Server payload `data`: `{ v, nid, did, type, link }` and nothing else is trusted. */
export type PushData = { nid: string; did: string | null; type: string | null; link: string };

export function parsePushData(data: unknown): PushData | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.v !== 1 || typeof d.nid !== 'string' || !UUID_RE.test(d.nid)) return null;
  const did = typeof d.did === 'string' && DELIVERY_RE.test(d.did) ? d.did : null;
  return {
    nid: d.nid,
    did,
    type: typeof d.type === 'string' ? d.type.slice(0, 64) : null,
    link: resolveNotificationHref(typeof d.link === 'string' ? d.link : null),
  };
}

export const SIGN_IN_HREF = '/(tabs)/profile';

/** A tap while signed out only ever reaches sign-in; the link is never followed. */
export function pushTapTarget(data: PushData | null, signedIn: boolean): string {
  if (!signedIn) return SIGN_IN_HREF;
  return data ? data.link : NOTIFICATIONS_HREF;
}

/** Remembers recent keys so cold-start + listener (or a duplicate Expo handoff) act once. */
export class RecentKeys {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly windowMs: number,
    private readonly max = 200,
  ) {}

  /** true the first time a key is seen inside the window. */
  firstSeen(key: string, now: number): boolean {
    for (const [k, at] of this.seen) {
      if (now - at > this.windowMs) this.seen.delete(k);
    }
    if (this.seen.has(key)) return false;
    this.seen.set(key, now);
    if (this.seen.size > this.max) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }
}

/** Android channels; ids must match the server's ANDROID_CHANNEL_BY_CATEGORY. */
export const ANDROID_CHANNELS = [
  { id: 'activity', name: 'Drafts and Collections', importance: 'high' },
  { id: 'social', name: 'Followers and likes', importance: 'default' },
  { id: 'account', name: 'Account', importance: 'high' },
  { id: 'promo', name: 'News and offers', importance: 'low' },
] as const;

export function isInstallationId(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
