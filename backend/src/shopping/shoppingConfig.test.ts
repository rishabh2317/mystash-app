import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import {
  loadShoppingConfiguration,
  resetShoppingConfigurationCache,
  resolveShoppingSelectionForProduct,
  setShoppingConfigurationForTests,
} from './ShoppingConfiguration';
import {
  applyShoppingSelectionPrecedence,
  isExactProductBuyingUrl,
  mergeShoppingSelectionIntoMetadata,
  readShoppingSelectionConfig,
} from './shoppingConfig';
import { classifyShoppingProvider } from './shoppingPriorityConfig';

afterEach(() => {
  resetShoppingConfigurationCache();
});

describe('isExactProductBuyingUrl', () => {
  it('accepts Amazon and retailer PDP paths', () => {
    assert.equal(
      isExactProductBuyingUrl('https://www.amazon.in/dp/B0DGHYQCTQ'),
      true,
    );
    assert.equal(
      isExactProductBuyingUrl('https://amzn.in/d/01fhRXW8'),
      true,
    );
    assert.equal(
      isExactProductBuyingUrl('https://a.co/d/xyz789'),
      true,
    );
    assert.equal(
      isExactProductBuyingUrl('https://www.flipkart.com/product/p/itm123'),
      true,
    );
  });

  it('rejects brand hubs and shallow category pages', () => {
    assert.equal(isExactProductBuyingUrl('https://www.apple.com/iphone/'), false);
    assert.equal(isExactProductBuyingUrl('https://www.apple.com/in/iphone/'), false);
    assert.equal(isExactProductBuyingUrl('https://www.amazon.in/'), false);
  });

  it('classifies Amazon short-link hosts as the amazon shopping provider', () => {
    assert.equal(classifyShoppingProvider('https://amzn.in/d/01fhRXW8'), 'amazon');
    assert.equal(classifyShoppingProvider('https://a.co/d/xyz789'), 'amazon');
    assert.equal(classifyShoppingProvider('https://amzn.com/d/abc123'), 'amazon');
  });
});

describe('applyShoppingSelectionPrecedence', () => {
  const offers = [
    { url: 'https://www.apple.com/iphone/', sourceType: 'OFFICIAL' },
    { url: 'https://www.amazon.in/dp/B0DGHYQCTQ', sourceType: 'MARKETPLACE' },
  ];

  it('configured URL always wins over discovery and resolver', () => {
    const result = applyShoppingSelectionPrecedence({
      config: { configuredBuyingUrl: 'https://campaign.example/buy/iphone-16e' },
      discoveredOffers: offers,
      resolverWinnerUrl: 'https://www.apple.com/iphone/',
    });
    assert.equal(result.source, 'configured_url');
    assert.equal(result.preferredShoppingUrl, 'https://campaign.example/buy/iphone-16e');
  });

  it('preferred merchant uses exact product URL only', () => {
    const result = applyShoppingSelectionPrecedence({
      config: { preferredMerchant: 'amazon' },
      discoveredOffers: offers,
      resolverWinnerUrl: 'https://www.apple.com/iphone/',
    });
    assert.equal(result.source, 'preferred_merchant_exact');
    assert.equal(result.preferredShoppingUrl, 'https://www.amazon.in/dp/B0DGHYQCTQ');
  });

  it('preferred merchant does not treat brand hubs as exact', () => {
    const result = applyShoppingSelectionPrecedence({
      config: { preferredMerchant: 'official' },
      discoveredOffers: offers,
      resolverWinnerUrl: 'https://www.apple.com/iphone/',
    });
    assert.equal(result.source, 'resolver');
    assert.equal(result.preferredShoppingUrl, 'https://www.apple.com/iphone/');
  });

  it('falls back to resolver when no config', () => {
    const result = applyShoppingSelectionPrecedence({
      config: null,
      discoveredOffers: offers,
      resolverWinnerUrl: 'https://www.apple.com/iphone/',
    });
    assert.equal(result.source, 'resolver');
  });
});

describe('shoppingSelection metadata helpers', () => {
  it('round-trips config via metadata', () => {
    const merged = mergeShoppingSelectionIntoMetadata(
      { source: 'test' },
      { configuredBuyingUrl: 'https://buy.example/x', preferredMerchant: 'amazon' },
    );
    const read = readShoppingSelectionConfig(merged);
    assert.equal(read?.configuredBuyingUrl, 'https://buy.example/x');
    assert.equal(read?.preferredMerchant, 'amazon');
  });
});

describe('ShoppingConfiguration file boundary', () => {
  it('resolves productOverrides configuredBuyingUrl authoritatively', () => {
    setShoppingConfigurationForTests({
      preferredMerchant: 'amazon',
      merchantPriority: ['amazon', 'official', 'merchant'],
      productOverrides: {
        'cat-campaign': {
          configuredBuyingUrl: 'https://brand.example/campaign/buy',
        },
      },
    });
    const resolved = resolveShoppingSelectionForProduct('cat-campaign');
    assert.equal(
      resolved.selection.configuredBuyingUrl,
      'https://brand.example/campaign/buy',
    );
    assert.equal(resolved.selection.preferredMerchant, 'amazon');
    assert.deepEqual(resolved.merchantPriority, ['amazon', 'official', 'merchant']);
  });

  it('loads default configuration shape from disk when present', () => {
    resetShoppingConfigurationCache();
    const cfg = loadShoppingConfiguration({ reload: true });
    assert.ok(Array.isArray(cfg.merchantPriority));
    assert.ok(cfg.merchantPriority.includes('amazon'));
    assert.equal(typeof cfg.productOverrides, 'object');
  });
});
