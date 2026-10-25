export const NOTIFICATIONS_FALLBACK_LINK = '/notifications';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const ALLOWED: RegExp[] = [
  new RegExp(`^/collection/${UUID}$`),
  /^\/creator\/[a-z0-9._]{3,30}$/,
  new RegExp(`^/\\(tabs\\)/create/review\\?ingestId=${UUID}$`),
  /^\/settings$/,
  /^\/analytics$/,
  /^\/notifications$/,
];

export function isAllowedDeepLink(link: string): boolean {
  return ALLOWED.some((re) => re.test(link));
}

export function safeDeepLink(link: string | null | undefined): string {
  return link && isAllowedDeepLink(link) ? link : NOTIFICATIONS_FALLBACK_LINK;
}

export function collectionLink(collectionId: string): string {
  return safeDeepLink(`/collection/${collectionId}`);
}

export function ingestReviewLink(ingestId: string): string {
  return safeDeepLink(`/(tabs)/create/review?ingestId=${ingestId}`);
}

export function creatorLink(username: string): string {
  return safeDeepLink(`/creator/${username.toLowerCase()}`);
}
