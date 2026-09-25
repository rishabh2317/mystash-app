import type { ExtractedMerchantPrice } from '../types';

function normalizeAmount(raw: string): string | null {
  const cleaned = raw.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Deterministic embedded product-state parsers for common merchant page shapes.
 * Only accepts explicit numeric price fields — never guesses from free text.
 */
export function extractEmbeddedStatePrice(html: string): ExtractedMerchantPrice | null {
  const patterns: Array<{ re: RegExp; currency?: string | null }> = [
    // Amazon-style landingAsin / priceToPay
    {
      re: /"priceToPay"\s*:\s*\{[^}]*"amount"\s*:\s*([\d.]+)/i,
    },
    {
      re: /"displayPrice"\s*:\s*"?\s*([\d,.]+)"?/i,
    },
    {
      re: /"priceAmount"\s*:\s*"?([\d.]+)"?/i,
    },
    {
      re: /"current_price"\s*:\s*"?([\d.]+)"?/i,
    },
    {
      re: /"finalPrice"\s*:\s*"?([\d.]+)"?/i,
    },
    {
      re: /data-asin-price=["']([\d.]+)["']/i,
    },
  ];

  for (const { re } of patterns) {
    const m = html.match(re);
    if (!m?.[1]) continue;
    const price = normalizeAmount(m[1].replace(/,/g, ''));
    if (!price) continue;

    let currency: string | null = null;
    const cur =
      html.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/i) ??
      html.match(/"currency"\s*:\s*"([A-Z]{3})"/i) ??
      html.match(/"currencyCode"\s*:\s*"([A-Z]{3})"/i);
    if (cur?.[1]) currency = cur[1].toUpperCase();

    return { price, currency, availability: null };
  }

  return null;
}
