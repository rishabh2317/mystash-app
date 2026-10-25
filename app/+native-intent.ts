import { rewriteNativeAuthCallbackPath } from '@/src/auth/oauthCallbackOwnership';
import { rewriteNativeOAuthCallbackPath } from '@/src/ui/connectedAccounts';

/**
 * Runs before Expo Router navigates an incoming native URL.
 * In-flight `openAuthSessionAsync` listeners own Google Auth and YouTube
 * return hops; Expo Router must not also mount those callbacks.
 */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | null {
  const connected = rewriteNativeOAuthCallbackPath(path, initial);
  if (connected !== undefined) return connected;
  const auth = rewriteNativeAuthCallbackPath(path, initial);
  if (auth !== undefined) return auth;
  return path;
}
