/**
 * @deprecated Prefer `@/src/services/commerceCountry`.
 * Thin compatibility wrapper around the commerce country resolver.
 */
export {
  getCommerceCountry as resolveUserCountry,
  resolveCommerceCountry,
} from '@/src/services/commerceCountry';

export { countryFromLocaleTag as countryFromLocaleTagCompat } from '@/src/services/commerceCountry/resolve';

import { resolveCommerceCountry } from '@/src/services/commerceCountry/resolve';

export function deviceLocaleTag(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || null;
  } catch {
    return null;
  }
}

export function resolveUserCountrySync(profileCountry?: string | null) {
  return resolveCommerceCountry({
    profileCountry,
    deviceLocale: deviceLocaleTag(),
  });
}
