/** Exhaust an API's existing cursor contract before client-side filtering.
 * Partial results are never silently presented as the complete saved dataset. */
export async function collectStashPages<T>(
  read: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string | null }>,
  identity: (item: T) => string,
  isCurrent: () => boolean = () => true,
): Promise<T[]> {
  const items = new Map<string, T>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    if (!isCurrent()) throw new Error('Stash request superseded');
    const page = await read(cursor);
    if (!isCurrent()) throw new Error('Stash request superseded');
    for (const item of page.items) if (!items.has(identity(item))) items.set(identity(item), item);
    cursor = page.nextCursor ?? undefined;
    if (cursor) {
      if (seen.has(cursor)) throw new Error('Stash pagination did not advance');
      seen.add(cursor);
    }
  } while (cursor);
  return [...items.values()];
}
