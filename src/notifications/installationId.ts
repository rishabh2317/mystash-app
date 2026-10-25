import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { isInstallationId } from './pushPolicy';

const KEY = 'mystash.push.installation_id';

/** Random per-install id in SecureStore; only ever sent to its own account's API calls. */
export async function getInstallationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY).catch(() => null);
  if (isInstallationId(existing)) return existing;
  return rotateInstallationId();
}

/** Used after a 409 takeover rejection: this install becomes a new installation. */
export async function rotateInstallationId(): Promise<string> {
  const next = Crypto.randomUUID();
  await SecureStore.setItemAsync(KEY, next);
  return next;
}

export async function peekInstallationId(): Promise<string | null> {
  const existing = await SecureStore.getItemAsync(KEY).catch(() => null);
  return isInstallationId(existing) ? existing : null;
}
