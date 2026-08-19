import { randomBytes } from 'node:crypto';

export function generateCollectionSlug(seed?: string | null): string {
  const base = (seed ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const suffix = randomBytes(3).toString('hex');
  return base ? `${base}-${suffix}` : `c-${suffix}`;
}
