import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoCrypto from 'expo-crypto';

const KEY = 'mystash_engagement_anonymous_id';

/**
 * Stable device-scoped anonymous_id for Engagement facts when logged out.
 * Not an Engagement SoT — only an actor identifier for anonymous views/shares.
 */
export async function getOrCreateAnonymousId(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY);
  if (existing?.trim()) return existing.trim();
  const next = ExpoCrypto.randomUUID();
  await AsyncStorage.setItem(KEY, next);
  return next;
}
