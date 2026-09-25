import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { hydrateLivePrices } from '@/src/services/livePricesApi';
import { merchantBrowserPath } from '@/src/ui/merchantBrowser';
import {
  PRODUCT_PAGE_COPY,
  productPagePriceFreshnessLabel,
} from '@/src/ui/productPage';

const ROOT = process.cwd();

describe('live prices + merchant browser', () => {
  it('hydrates live price results without inventing prices', () => {
    const payload = hydrateLivePrices({
      productId: 'p1',
      country: 'IN',
      fetchedAt: '2026-09-22T10:00:00.000Z',
      results: [
        {
          offerId: 'o1',
          merchantName: 'Amazon',
          merchantUrl: 'https://www.amazon.in/dp/X',
          price: '69999',
          currency: 'INR',
          availability: 'In stock',
          fetchedAt: '2026-09-22T10:00:00.000Z',
          source: 'live',
          status: 'success',
        },
        {
          offerId: 'o2',
          merchantName: 'Flipkart',
          merchantUrl: 'https://www.flipkart.com/p',
          price: '68999',
          currency: 'INR',
          availability: null,
          fetchedAt: null,
          source: 'fallback',
          status: 'timeout',
        },
      ],
    });
    assert.equal(payload?.results.length, 2);
    assert.equal(payload?.results[0]?.source, 'live');
    assert.equal(payload?.results[1]?.source, 'fallback');
    assert.equal(payload?.results[1]?.status, 'timeout');
  });

  it('labels live vs stale freshness correctly', () => {
    assert.equal(productPagePriceFreshnessLabel('loading'), PRODUCT_PAGE_COPY.priceUpdating);
    assert.equal(productPagePriceFreshnessLabel('live'), PRODUCT_PAGE_COPY.priceLive);
    assert.equal(productPagePriceFreshnessLabel('stale'), PRODUCT_PAGE_COPY.priceStale);
    assert.equal(productPagePriceFreshnessLabel('stored'), null);
  });

  it('builds a reusable merchant browser path', () => {
    assert.equal(
      merchantBrowserPath('https://www.amazon.in/dp/X', 'Amazon'),
      '/merchant-browser?url=https%3A%2F%2Fwww.amazon.in%2Fdp%2FX&title=Amazon',
    );
  });

  it('resolves country without GPS', () => {
    const src = readFileSync(join(ROOT, 'src/services/commerceCountry/resolve.ts'), 'utf8');
    assert.match(src, /profileCountry/);
    assert.match(src, /deviceLocale|countryFromLocaleTag/);
    assert.match(src, /COMMERCE_COUNTRY_DEFAULT/);
    assert.doesNotMatch(src, /getCurrentPosition|expo-location/i);
  });

  it('Product Page refreshes prices asynchronously and opens in-app browser', () => {
    const page = readFileSync(join(ROOT, 'components/product/ProductPage.tsx'), 'utf8');
    assert.match(page, /fetchLivePrices/);
    assert.match(page, /pricesLoading/);
    assert.match(page, /mergeLiveOffer|freshness/);
    assert.match(page, /openProductShopping/);
    const browser = readFileSync(join(ROOT, 'app/merchant-browser.tsx'), 'utf8');
    assert.match(browser, /WebView/);
    assert.match(browser, /onClose|Close/);
    assert.match(browser, /goBack|canGoBack/);
  });

  it('shopping click opens merchant browser with server-resolved URL', () => {
    const click = readFileSync(join(ROOT, 'src/services/shoppingClick.ts'), 'utf8');
    assert.match(click, /resolveProductShoppingDestination/);
    assert.match(click, /router\.push/);
    assert.match(click, /merchantBrowserPath/);
    assert.doesNotMatch(click, /Linking\.openURL/);
  });
});
