/**
 * Shared product-URL identity helpers used by page classification,
 * PDP scoring, and shopping exact-buying checks.
 */

/** Amazon marketplace hosts, including short-link domains. */
export function isAmazonMarketplaceHost(host: string): boolean {
  const h = host.replace(/^www\./i, '').toLowerCase();
  if (h === 'a.co' || h.endsWith('.a.co')) return true;
  if (h === 'amzn.in' || h.endsWith('.amzn.in')) return true;
  if (h === 'amzn.com' || h.endsWith('.amzn.com')) return true;
  return /(^|\.)amazon\./i.test(h) || /(^|\.)amzn\./i.test(h);
}

export function isMarketplaceHost(host: string): boolean {
  if (isAmazonMarketplaceHost(host)) return true;
  return /(^|\.)(flipkart\.|myntra\.|ajio\.|nykaa\.|walmart\.|bestbuy\.|target\.|ebay\.)/i.test(
    host,
  );
}

/** Exact PDP paths, including Amazon short links `/d/{id}`. `dp` must precede `d`. */
export const EXACT_PRODUCT_PATH =
  /\/(dp|d|gp\/product|product|products|p|pd|item|buy)\/[^/?#]+/i;
export const EXACT_PRODUCT_HTML = /\/[a-z0-9][a-z0-9-]{4,}\.html$/i;

export function isExactProductBuyingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || '/';
    if (path === '/' || path === '') return false;
    const segments = path.split('/').filter(Boolean);
    if (segments.length <= 1 && !EXACT_PRODUCT_HTML.test(path)) return false;
    return EXACT_PRODUCT_PATH.test(path) || EXACT_PRODUCT_HTML.test(path);
  } catch {
    return false;
  }
}
