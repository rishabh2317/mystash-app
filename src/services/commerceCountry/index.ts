import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  detectCountryFromLocation,
  getForegroundPermissionState,
  requestForegroundLocationPermission,
  type LocationPermissionState,
} from '@/src/services/commerceCountry/location';
import {
  LOCATION_CHECK_COOLDOWN_MS,
  resolveCommerceCountry,
  shouldRefreshLocation,
  type CommerceCountrySnapshot,
} from '@/src/services/commerceCountry/resolve';
import {
  ensureMe,
  fetchMe,
  updateMyCommerceCountry,
  type UserSettingsViewModel,
} from '@/src/services/userApi';

const ONBOARDING_PROMPT_KEY = 'mystash.commerceCountry.onboardingPrompted';

let cachedSnapshot: CommerceCountrySnapshot | null = null;
let inFlightResolve: Promise<CommerceCountrySnapshot> | null = null;
let inFlightForeground: Promise<CommerceCountrySnapshot | null> | null = null;

function deviceLocaleTag(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || null;
  } catch {
    return null;
  }
}

function snapshotFromSettings(me: UserSettingsViewModel | null): CommerceCountrySnapshot {
  return resolveCommerceCountry({
    profileCountry: me?.country ?? null,
    countrySource: me?.countrySource ?? null,
    deviceLocale: deviceLocaleTag(),
  });
}

async function loadMe(): Promise<UserSettingsViewModel | null> {
  try {
    return await fetchMe();
  } catch {
    try {
      return await ensureMe();
    } catch {
      return null;
    }
  }
}

/** Latest resolved commerce country for live pricing / Buy (no GPS from Product Page). */
export async function getCommerceCountry(): Promise<CommerceCountrySnapshot> {
  if (cachedSnapshot) return cachedSnapshot;
  if (inFlightResolve) return inFlightResolve;
  inFlightResolve = (async () => {
    const me = await loadMe();
    const snap = snapshotFromSettings(me);
    cachedSnapshot = snap;
    return snap;
  })().finally(() => {
    inFlightResolve = null;
  });
  return inFlightResolve;
}

export function getCachedCommerceCountry(): CommerceCountrySnapshot | null {
  return cachedSnapshot;
}

export function clearCommerceCountryCache(): void {
  cachedSnapshot = null;
}

/**
 * One-time onboarding prompt for foreground location.
 * Does not re-prompt when already asked or when permission is denied.
 */
export async function promptCommerceLocationOnboarding(): Promise<{
  permission: LocationPermissionState;
  snapshot: CommerceCountrySnapshot;
}> {
  const already = await AsyncStorage.getItem(ONBOARDING_PROMPT_KEY);
  const current = await getForegroundPermissionState();
  if (already === '1' || current === 'denied') {
    const snap = await getCommerceCountry();
    return { permission: current, snapshot: snap };
  }

  await AsyncStorage.setItem(ONBOARDING_PROMPT_KEY, '1');
  const permission = await requestForegroundLocationPermission();
  if (permission === 'granted') {
    const snap = await applyDetectedLocation({ force: false, allowFreshFix: true });
    return { permission, snapshot: snap ?? (await getCommerceCountry()) };
  }
  const snap = await getCommerceCountry();
  return { permission, snapshot: snap };
}

/**
 * App foreground re-check: only when permission already granted, respects cooldown,
 * never overwrites a manual country override.
 */
export async function onCommerceCountryAppForeground(): Promise<CommerceCountrySnapshot | null> {
  if (inFlightForeground) return inFlightForeground;
  inFlightForeground = (async () => {
    const permission = await getForegroundPermissionState();
    if (permission !== 'granted') {
      return getCommerceCountry();
    }
    const me = await loadMe();
    if (me?.countrySource === 'manual') {
      const snap = snapshotFromSettings(me);
      cachedSnapshot = snap;
      return snap;
    }
    if (
      !shouldRefreshLocation({
        lastLocationCheckAt: me?.lastLocationCheckAt,
        cooldownMs: LOCATION_CHECK_COOLDOWN_MS,
      })
    ) {
      const snap = snapshotFromSettings(me);
      cachedSnapshot = snap;
      return snap;
    }
    return applyDetectedLocation({ force: false, allowFreshFix: true, me });
  })().finally(() => {
    inFlightForeground = null;
  });
  return inFlightForeground;
}

async function applyDetectedLocation(options: {
  force: boolean;
  allowFreshFix: boolean;
  me?: UserSettingsViewModel | null;
}): Promise<CommerceCountrySnapshot | null> {
  const detected = await detectCountryFromLocation({
    allowFreshFix: options.allowFreshFix,
  });
  if (!detected.country) {
    // Location failed — keep saved country / locale / default fallback.
    clearCommerceCountryCache();
    return getCommerceCountry();
  }

  const now = new Date().toISOString();
  try {
    const result = await updateMyCommerceCountry({
      country: detected.country,
      source: 'location',
      countryDetectedAt: now,
      lastLocationCheckAt: now,
      force: options.force,
    });
    const snap = snapshotFromSettings(result.user);
    cachedSnapshot = snap;
    return snap;
  } catch {
    const snap = resolveCommerceCountry({
      profileCountry: detected.country,
      countrySource: 'location',
      deviceLocale: deviceLocaleTag(),
    });
    cachedSnapshot = snap;
    return snap;
  }
}

/** Explicit user override — automatic location must not overwrite. */
export async function setManualCommerceCountry(country: string): Promise<CommerceCountrySnapshot> {
  const result = await updateMyCommerceCountry({
    country,
    source: 'manual',
    lastLocationCheckAt: new Date().toISOString(),
  });
  const snap = snapshotFromSettings(result.user);
  cachedSnapshot = snap;
  return snap;
}

/** Switch back to automatic location detection. */
export async function enableAutomaticCommerceLocation(): Promise<CommerceCountrySnapshot> {
  const permission = await getForegroundPermissionState();
  if (permission !== 'granted') {
    const requested = await requestForegroundLocationPermission();
    if (requested !== 'granted') {
      return getCommerceCountry();
    }
  }
  const snap = await applyDetectedLocation({ force: true, allowFreshFix: true });
  return snap ?? (await getCommerceCountry());
}

export {
  LOCATION_PERMISSION_RATIONALE,
  resolveCommerceCountry,
  shouldRefreshLocation,
  commerceCountryLabel,
  type CommerceCountrySnapshot,
  type CommerceCountrySource,
} from '@/src/services/commerceCountry/resolve';
