import * as Location from 'expo-location';

import {
  LOCATION_CHECK_COOLDOWN_MS,
  LOCATION_PERMISSION_RATIONALE,
  normalizeIso2Country,
} from '@/src/services/commerceCountry/resolve';

export type LocationPermissionState = 'granted' | 'denied' | 'undetermined';

export type LocationCountryResult = {
  country: string | null;
  /** True when a fresh position was requested (vs last-known only). */
  usedFreshFix: boolean;
};

export async function getForegroundPermissionState(): Promise<LocationPermissionState> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return 'granted';
  if (current.canAskAgain === false) return 'denied';
  if (current.status === Location.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

/**
 * Request foreground location only (never background).
 * Shows the OS dialog with the configured rationale string.
 */
export async function requestForegroundLocationPermission(): Promise<LocationPermissionState> {
  const current = await getForegroundPermissionState();
  if (current === 'granted') return 'granted';
  if (current === 'denied') return 'denied';
  const result = await Location.requestForegroundPermissionsAsync();
  return result.granted ? 'granted' : 'denied';
}

async function countryFromCoords(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  try {
    const places = await Location.reverseGeocodeAsync({ latitude, longitude });
    for (const place of places) {
      const iso =
        normalizeIso2Country(place.isoCountryCode) ??
        normalizeIso2Country(place.country);
      if (iso) return iso;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Derive ISO country from last-known or (optionally) a fresh low-accuracy fix.
 * Never returns or persists coordinates to callers of the commerce layer.
 */
export async function detectCountryFromLocation(options?: {
  allowFreshFix?: boolean;
}): Promise<LocationCountryResult> {
  const allowFresh = options?.allowFreshFix !== false;

  try {
    const last = await Location.getLastKnownPositionAsync({
      maxAge: LOCATION_CHECK_COOLDOWN_MS,
      requiredAccuracy: 5000,
    });
    if (last?.coords) {
      const country = await countryFromCoords(last.coords.latitude, last.coords.longitude);
      if (country) return { country, usedFreshFix: false };
    }
  } catch {
    /* fall through to fresh fix */
  }

  if (!allowFresh) return { country: null, usedFreshFix: false };

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Low,
      mayShowUserSettingsDialog: false,
    });
    const country = await countryFromCoords(
      position.coords.latitude,
      position.coords.longitude,
    );
    return { country, usedFreshFix: true };
  } catch {
    return { country: null, usedFreshFix: false };
  }
}

export { LOCATION_PERMISSION_RATIONALE };
