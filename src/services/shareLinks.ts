import { Share } from 'react-native';
import * as Linking from 'expo-linking';

import { recordCollectionShare, recordCreatorShare } from '@/src/services/engagementApi';
import { collectionPath, creatorPath } from '@/src/services/sharePaths';

export { collectionPath, creatorPath };

/**
 * Native-shareable deep link. Uses the app scheme (mystash://…) so social
 * and OS share sheets open the canonical Collection/Creator routes.
 */
export function buildCollectionShareUrl(collectionId: string): string {
  return Linking.createURL(collectionPath(collectionId));
}

export function buildCreatorShareUrl(username: string): string {
  return Linking.createURL(creatorPath(username));
}

/**
 * Opens the native share sheet. On completed share (`sharedAction`), records
 * Engagement `share` (not dismissed sheet / button-only).
 */
export async function shareCollection(input: {
  collectionId: string;
  title?: string | null;
  creatorId?: string | null;
  surface?: string | null;
}): Promise<boolean> {
  const title = input.title?.trim() || 'Collection on Mystash';
  const url = buildCollectionShareUrl(input.collectionId);
  const result = await Share.share({
    message: `${title}\n${url}`,
    url,
    title,
  });
  if (result.action !== Share.sharedAction) return false;
  try {
    await recordCollectionShare({
      collectionId: input.collectionId,
      creatorId: input.creatorId,
      surface: input.surface ?? 'native_share',
    });
    return true;
  } catch {
    // Share already completed for the user; analytics must not fail the UX.
    return true;
  }
}

/**
 * Native share for `/creator/[username]`. Records Engagement creator `share`
 * only when the OS reports `sharedAction`.
 */
export async function shareCreatorProfile(input: {
  username: string;
  displayName?: string | null;
  creatorId: string;
  surface?: string | null;
}): Promise<void> {
  const handle = input.username.trim().replace(/^@/, '');
  const url = buildCreatorShareUrl(handle);
  const title = input.displayName?.trim() || `@${handle}`;
  const result = await Share.share({
    message: `${title} on Mystash\n${url}`,
    url,
    title: `${title} on Mystash`,
  });
  if (result.action !== Share.sharedAction) return;
  try {
    await recordCreatorShare({
      creatorId: input.creatorId,
      surface: input.surface ?? 'creator_profile',
    });
  } catch {
    // Share already completed for the user; analytics must not fail the UX.
  }
}
