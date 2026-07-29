import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  pickVerificationMerchantUrl,
  resolveShoppingDestination,
} from './ShoppingDestinationResolver';

describe('ShoppingDestinationResolver', () => {
  it('prefers an official PDP even when a marketplace leads provider priority', () => {
    const offers = [
      {
        url: 'https://www.apple.com/macbook-air/',
        sourceTier: 'official' as const,
        merchant: 'Apple',
      },
      {
        url: 'https://www.amazon.in/dp/mac',
        sourceTier: 'marketplace' as const,
        merchant: 'Amazon',
      },
      {
        url: 'https://www.flipkart.com/p/mac',
        sourceTier: 'marketplace' as const,
        merchant: 'Flipkart',
      },
    ];

    const shopping = resolveShoppingDestination(offers, [
      'amazon',
      'official',
      'flipkart',
      'merchant',
    ]);
    const verification = pickVerificationMerchantUrl(offers);

    assert.equal(shopping?.preferredShoppingUrl, 'https://www.apple.com/macbook-air/');
    assert.equal(shopping?.shoppingProvider, 'official');
    assert.equal(verification?.merchantUrl, 'https://www.apple.com/macbook-air/');
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
        candidatePageType: 'official_brand_news' as const,
        shoppingEligible: false,
      },
      {
        url: 'https://www.nike.com/t/alphafly-3-mens-road-racing-shoes',
        sourceTier: 'official' as const,
        merchant: 'Nike',
        candidatePageType: 'official_product' as const,
        shoppingEligible: true,
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
  });

  it('selects the official Adidas PDP over a retailer', () => {
    const shopping = resolveShoppingDestination([
      {
        url: 'https://www.footballboots.co.uk/adidas-f50-messi',
        merchant: 'Football Boots',
        sourceTier: 'retailer',
        candidatePageType: 'retailer_pdp',
        shoppingEligible: true,
        pdpScore: 0.98,
        availability: 'In stock',
      },
      {
        url: 'https://www.adidas.com/us/f50-elite-firm-ground-cleats/ABC.html',
        merchant: 'Adidas',
        sourceTier: 'official',
        candidatePageType: 'official_product',
        shoppingEligible: true,
        pdpScore: 0.9,
        availability: 'In stock',
      },
    ]);

    assert.match(shopping?.preferredShoppingUrl ?? '', /adidas\.com/);
  });
});
