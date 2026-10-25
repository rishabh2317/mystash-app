import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  NotificationsApiError,
  registerPushInstallation,
  revokePushInstallation,
  unregisterPushInstallation,
} from '@/src/services/notificationsApi';
import { supabase } from '@/src/services/supabase';
import { getInstallationId, peekInstallationId, rotateInstallationId } from './installationId';
import {
  ANDROID_CHANNELS,
  canReceivePush,
  mapOsPermission,
  pushEnabled,
  shouldRegister,
  type LastRegistration,
  type OsPermission,
} from './pushPolicy';
import {
  replayPendingRevocation,
  storeIssuedCredential,
  unlinkOnSignOut,
  type RevocationRecord,
  type SignOutUnlinkDeps,
} from './signOutUnlink';

const LAST_KEY = 'mystash.push.last_registration';
const EXPLAINER_KEY = 'mystash.push.explainer_shown';
const REVOCATION_KEY = 'mystash.push.revocation';
/** Phase 5 stored a Supabase access token here; deleted on sight and never written again. */
const LEGACY_PENDING_UNREGISTER_KEY = 'mystash.push.pending_unregister';
const SIGN_OUT_UNLINK_TIMEOUT_MS = 3_000;
const REPLAY_TIMEOUT_MS = 5_000;

export function easProjectId(): string | null {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? null;
}

/** Push needs the Release B flag, a physical device, a native platform and an EAS project id. */
export function pushSupported(): boolean {
  return pushEnabled() && Platform.OS !== 'web' && Device.isDevice && Boolean(easProjectId());
}

export async function readPushPermission(): Promise<{ permission: OsPermission; canAskAgain: boolean }> {
  const status = await Notifications.getPermissionsAsync();
  return { permission: mapOsPermission(status.status, status.ios?.status), canAskAgain: status.canAskAgain };
}

/** Android 13+ shows the permission dialog only once a channel exists. */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const importance = {
    high: Notifications.AndroidImportance.HIGH,
    default: Notifications.AndroidImportance.DEFAULT,
    low: Notifications.AndroidImportance.LOW,
  } as const;
  for (const channel of ANDROID_CHANNELS) {
    await Notifications.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      importance: importance[channel.importance],
    });
  }
}

async function readLast(): Promise<LastRegistration | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as LastRegistration) : null;
  } catch {
    return null;
  }
}

function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

function deviceLocale(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? null;
  } catch {
    return null;
  }
}

function appVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

async function putRegistration(installationId: string, token: string, osPermission: OsPermission): Promise<string> {
  const body = {
    token,
    platform: Platform.OS === 'ios' ? ('ios' as const) : ('android' as const),
    osPermission,
    appVersion: appVersion(),
    appBuild: Constants.nativeBuildVersion ?? null,
    locale: deviceLocale(),
    timezone: deviceTimezone(),
    apnsEnvironment: null,
  };
  let boundId = installationId;
  let issued: { revocationCredential: string | null };
  try {
    issued = await registerPushInstallation(installationId, body);
  } catch (e) {
    // Another account holds this installation with a different token: become a new installation.
    if (!(e instanceof NotificationsApiError && e.statusCode === 409)) throw e;
    boundId = await rotateInstallationId();
    issued = await registerPushInstallation(boundId, body);
  }
  await storeIssuedCredential(revocationDeps(), boundId, issued.revocationCredential);
  return boundId;
}

let inFlight: Promise<SyncResult> | null = null;

export type SyncResult = 'registered' | 'unchanged' | 'skipped' | 'failed';

/**
 * Registers this installation for `userId` when the OS allows push. Never prompts.
 * Called on launch, on foreground (throttled to once a day) and on token rotation.
 */
export function syncPushRegistration(userId: string, opts: { force?: boolean } = {}): Promise<SyncResult> {
  if (!pushSupported()) return Promise.resolve('skipped');
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<SyncResult> => {
    try {
      await replayPendingUnlink();
      const { permission } = await readPushPermission();
      const last = await readLast();

      if (!canReceivePush(permission)) {
        // Revoked in OS settings: tell the server so it stops creating deliveries for this device.
        if (last && last.userId === userId && last.osPermission !== permission) {
          const installationId = await putRegistration(last.installationId, last.token, permission);
          await AsyncStorage.setItem(LAST_KEY, JSON.stringify({ ...last, installationId, osPermission: permission, at: Date.now() }));
          return 'registered';
        }
        return 'skipped';
      }

      const projectId = easProjectId();
      if (!projectId) return 'skipped';
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      const installationId = await getInstallationId();
      const snapshot = { userId, installationId, token, osPermission: permission, appVersion: appVersion() };
      if (!shouldRegister(last, snapshot, Date.now(), opts.force)) return 'unchanged';

      const boundId = await putRegistration(installationId, token, permission);
      const saved: LastRegistration = { ...snapshot, installationId: boundId, at: Date.now() };
      await AsyncStorage.setItem(LAST_KEY, JSON.stringify(saved));
      return 'registered';
    } catch (e) {
      if (__DEV__) console.warn('[push] registration failed', (e as Error).message);
      return 'failed';
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** OS permission dialog; only ever called from an explicit user action or the post-publish/follow explainer. */
export async function requestPushPermission(): Promise<OsPermission> {
  await ensureAndroidChannels();
  const status = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return mapOsPermission(status.status, status.ios?.status);
}

export async function explainerShown(): Promise<boolean> {
  return (await AsyncStorage.getItem(EXPLAINER_KEY).catch(() => null)) === '1';
}

export async function markExplainerShown(): Promise<void> {
  await AsyncStorage.setItem(EXPLAINER_KEY, '1').catch(() => undefined);
}

function isNetworkFailure(e: unknown): boolean {
  return !(e instanceof NotificationsApiError) || e.statusCode >= 500;
}

function revocationDeps(unlinkWithSession: SignOutUnlinkDeps['unlinkWithSession'] = null): SignOutUnlinkDeps {
  return {
    readRecord: async () => {
      try {
        const raw = await SecureStore.getItemAsync(REVOCATION_KEY);
        return raw ? (JSON.parse(raw) as RevocationRecord) : null;
      } catch {
        return null;
      }
    },
    writeRecord: async (record) => {
      await SecureStore.setItemAsync(REVOCATION_KEY, JSON.stringify(record)).catch(() => undefined);
    },
    deleteRecord: async () => {
      await SecureStore.deleteItemAsync(REVOCATION_KEY).catch(() => undefined);
    },
    unlinkWithSession,
    revokeWithCredential: (installationId, credential) =>
      revokePushInstallation(installationId, credential, { timeoutMs: REPLAY_TIMEOUT_MS }),
    isRetryable: isNetworkFailure,
  };
}

/** Replays a credential unlink left behind by an offline sign-out, before any re-registration. */
export async function replayPendingUnlink(): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(LEGACY_PENDING_UNREGISTER_KEY).catch(() => undefined);
  await replayPendingRevocation(revocationDeps()).catch(() => undefined);
}

/**
 * Decision 5: unlink on the server before `supabase.auth.signOut()` (3 s budget), then
 * unregister locally. The local call never stands in for the server unlink. Offline, only
 * the installation's revocation credential is kept for replay, never the Supabase session.
 */
export async function unlinkPushBeforeSignOut(): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(LEGACY_PENDING_UNREGISTER_KEY).catch(() => undefined);
  const last = await readLast();
  const installationId = last?.installationId ?? (await peekInstallationId());
  const { data } = await supabase.auth.getSession();
  const withSession = data.session
    ? (id: string) => unregisterPushInstallation(id, { timeoutMs: SIGN_OUT_UNLINK_TIMEOUT_MS })
    : null;
  await unlinkOnSignOut(revocationDeps(withSession), installationId).catch(() => undefined);

  await AsyncStorage.removeItem(LAST_KEY).catch(() => undefined);
  await clearPresentedNotifications();
  await Notifications.unregisterForNotificationsAsync().catch(() => undefined);
}

/** On sign-out and account switch: nothing from the previous account stays on screen. */
export async function clearPresentedNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  await Notifications.setBadgeCountAsync(0).catch(() => undefined);
}
