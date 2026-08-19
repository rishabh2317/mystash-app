/** Canonical in-app Collection path for share/deep-link. */
export function collectionPath(collectionId: string): string {
  return `/collection/${collectionId.trim()}`;
}

/** Canonical in-app Creator path for share/deep-link. */
export function creatorPath(username: string): string {
  const handle = username.trim().replace(/^@/, '');
  return `/creator/${encodeURIComponent(handle)}`;
}
