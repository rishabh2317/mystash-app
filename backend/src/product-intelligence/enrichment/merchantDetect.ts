const HOST_LABELS: Record<string, string> = {
  'apple.com': 'Apple',
  'amazon.in': 'Amazon',
  'amazon.com': 'Amazon',
  'flipkart.com': 'Flipkart',
  'myntra.com': 'Myntra',
  'ajio.com': 'Ajio',
  'nykaa.com': 'Nykaa',
  'walmart.com': 'Walmart',
  'bestbuy.com': 'Best Buy',
  'target.com': 'Target',
  'ebay.com': 'eBay',
  'nike.com': 'Nike',
  'samsung.com': 'Samsung',
  'sony.com': 'Sony',
};

/** Populate `merchant` display label from URL host. */
export function detectMerchantLabel(merchantUrl: string): string {
  try {
    const host = new URL(merchantUrl).hostname.replace(/^www\./i, '').toLowerCase();
    if (HOST_LABELS[host]) return HOST_LABELS[host]!;
    for (const [suffix, label] of Object.entries(HOST_LABELS)) {
      if (host === suffix || host.endsWith(`.${suffix}`)) return label;
    }
    const base = host.split('.')[0] ?? host;
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return 'Merchant';
  }
}
