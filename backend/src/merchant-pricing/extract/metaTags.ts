import type { ExtractedMerchantPrice } from '../types';

function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
      'i',
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`,
      'i',
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

function normalizeAmount(raw: string): string | null {
  const cleaned = raw.trim().replace(/,/g, '').replace(/[^\d.]/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Structured meta-tag price extraction (Open Graph / product microdata).
 */
export function extractMetaPrice(html: string): ExtractedMerchantPrice | null {
  const pairs: Array<[string, string]> = [
    ['product:price:amount', 'product:price:currency'],
    ['og:price:amount', 'og:price:currency'],
    ['twitter:data1', 'twitter:label1'],
  ];

  for (const [amountKey, currencyKey] of pairs) {
    const amount = metaContent(html, amountKey);
    if (!amount) continue;
    const price = normalizeAmount(amount);
    if (!price) continue;
    const currencyRaw = metaContent(html, currencyKey);
    const currency =
      currencyRaw && /^[A-Za-z]{3}$/.test(currencyRaw.trim())
        ? currencyRaw.trim().toUpperCase()
        : null;
    return { price, currency, availability: null };
  }

  const itemPrice = metaContent(html, 'price');
  if (itemPrice) {
    const price = normalizeAmount(itemPrice);
    if (price) {
      const currencyRaw = metaContent(html, 'priceCurrency') ?? metaContent(html, 'currency');
      const currency =
        currencyRaw && /^[A-Za-z]{3}$/.test(currencyRaw.trim())
          ? currencyRaw.trim().toUpperCase()
          : null;
      return { price, currency, availability: null };
    }
  }

  return null;
}
