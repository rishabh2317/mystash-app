import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  pickVerificationMerchantUrl,
  resolveShoppingDestination,
} from './ShoppingDestinationResolver';

describe('ShoppingDestinationResolver', () => {
  it('prefers an exact marketplace PDP over an official brand hub', () => {
    const offers = [
      {
        url: 'https://www.apple.com/iphone/',
        sourceTier: 'official' as const,
        merchant: 'Apple',
        sourceType: 'OFFICIAL' as const,
        pageType: 'PRODUCT' as const,
        pdpScore: 0.47,
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: false,
          images: true,
          evidence: true,
        },
      },
      {
        url: 'https://www.amazon.in/dp/B0CHX3QBCH',
        sourceTier: 'marketplace' as const,
        merchant: 'Amazon',
        sourceType: 'MARKETPLACE' as const,
        pageType: 'PRODUCT' as const,
        pdpScore: 0.79,
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
      },
      {
        url: 'https://www.flipkart.com/p/iphone-15',
        sourceTier: 'marketplace' as const,
        merchant: 'Flipkart',
        sourceType: 'MARKETPLACE' as const,
        pageType: 'PRODUCT' as const,
        pdpScore: 0.7,
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
      },
    ];

    const shopping = resolveShoppingDestination(offers, [
      'amazon',
      'official',
      'flipkart',
      'merchant',
    ]);
    const verification = pickVerificationMerchantUrl(offers);

    assert.equal(shopping?.preferredShoppingUrl, 'https://www.amazon.in/dp/B0CHX3QBCH');
    assert.equal(shopping?.shoppingProvider, 'amazon');
    assert.equal(verification?.merchantUrl, 'https://www.amazon.in/dp/B0CHX3QBCH');
  });

  it('falls back through configurable priority', () => {
    const shopping = resolveShoppingDestination(
      [
        {
          url: 'https://www.flipkart.com/p/shoe',
          sourceTier: 'marketplace',
        },
        {
          url: 'https://nike.com/products/air',
          sourceTier: 'official',
        },
      ],
      ['amazon', 'official', 'flipkart'],
    );
    assert.equal(shopping?.shoppingProvider, 'official');
    assert.match(shopping?.preferredShoppingUrl ?? '', /nike\.com/);
  });

  it('never selects an official newsroom page for shopping', () => {
    const offers = [
      {
        url: 'https://about.nike.com/en/newsroom/releases/nike-alphafly-3',
        sourceTier: 'official' as const,
        merchant: 'Nike',
        sourceType: 'OFFICIAL' as const,
        pageType: 'NEWS' as const,
        capabilities: {
          metadata: true,
          commerce: false,
          specifications: false,
          images: true,
          evidence: true,
        },
      },
      {
        url: 'https://www.nike.com/t/alphafly-3-mens-road-racing-shoes',
        sourceTier: 'official' as const,
        merchant: 'Nike',
        sourceType: 'OFFICIAL' as const,
        pageType: 'PRODUCT' as const,
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
      },
    ];

    const shopping = resolveShoppingDestination(offers, ['official', 'merchant']);
    const verification = pickVerificationMerchantUrl(offers);

    assert.equal(
      shopping?.preferredShoppingUrl,
      'https://www.nike.com/t/alphafly-3-mens-road-racing-shoes',
    );
    assert.equal(
      verification?.merchantUrl,
      'https://www.nike.com/t/alphafly-3-mens-road-racing-shoes',
    );
    assert.equal(shopping?.offers[0]?.sourceType, 'OFFICIAL');
    assert.equal(shopping?.offers[0]?.pageType, 'PRODUCT');
    assert.equal(shopping?.offers[0]?.capabilities.commerce, true);
  });

  it('selects the official Adidas PDP over a retailer', () => {
    const shopping = resolveShoppingDestination([
      {
        url: 'https://www.footballboots.co.uk/adidas-f50-messi',
        merchant: 'Football Boots',
        sourceTier: 'retailer',
        sourceType: 'RETAILER',
        pageType: 'PRODUCT',
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
        pdpScore: 0.98,
        availability: 'In stock',
      },
      {
        url: 'https://www.adidas.com/us/f50-elite-firm-ground-cleats/ABC.html',
        merchant: 'Adidas',
        sourceTier: 'official',
        sourceType: 'OFFICIAL',
        pageType: 'PRODUCT',
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
        pdpScore: 0.9,
        availability: 'In stock',
      },
    ]);

    assert.match(shopping?.preferredShoppingUrl ?? '', /adidas\.com/);
  });

  it('does not let category/search pages beat an exact product PDP', () => {
    const shopping = resolveShoppingDestination(
      [
        {
          url: 'https://www.apple.com/shop/buy-iphone/iphone-search',
          merchant: 'Apple',
          sourceType: 'OFFICIAL',
          pageType: 'SEARCH',
          pdpScore: 0.2,
          capabilities: {
            metadata: true,
            commerce: true,
            specifications: false,
            images: true,
            evidence: true,
          },
        },
        {
          url: 'https://www.amazon.in/dp/B0CHX3QBCH',
          merchant: 'Amazon',
          sourceType: 'MARKETPLACE',
          pageType: 'PRODUCT',
          pdpScore: 0.79,
          capabilities: {
            metadata: true,
            commerce: true,
            specifications: true,
            images: true,
            evidence: true,
          },
        },
      ],
      ['amazon', 'official', 'merchant'],
    );
    assert.equal(shopping?.preferredShoppingUrl, 'https://www.amazon.in/dp/B0CHX3QBCH');
  });
});
