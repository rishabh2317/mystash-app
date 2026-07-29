import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyPdp } from './PdpClassifier';

describe('PdpClassifier', () => {
  it('hard rejects editorial, support, category and search URLs', () => {
    for (const url of [
      'https://nike.com/blog/air-max-history',
      'https://adidas.com/stories/running',
      'https://amazon.com/gp/help/customer',
      'https://support.apple.com/iphone',
      'https://shop.example/category/shoes',
      'https://shop.example/search?q=phone',
      'https://shop.example/collections/new',
    ]) {
      const result = classifyPdp({ url, title: 'Product' });
      assert.equal(result.verdict, 'not_pdp', url);
      assert.equal(result.hardNegative, true, url);
    }
  });

  it('accepts a product page only with multiple positive signals', () => {
    const result = classifyPdp({
      url: 'https://shop.example/products/sony-wh-1000xm6',
      title: 'Sony WH-1000XM6 Wireless Headphones',
      metadata: {
        hasProductJsonLd: true,
        hasOffer: true,
        price: '449.99',
        sku: 'WH1000XM6/B',
        hasAddToCart: true,
      },
    });
    assert.equal(result.verdict, 'pdp');
    assert.ok(result.score >= 0.8);
  });

  it('keeps an official homepage uncertain without product evidence', () => {
    const result = classifyPdp({ url: 'https://apple.com/', title: 'Apple' });
    assert.equal(result.verdict, 'uncertain');
    assert.equal(result.hardNegative, false);
  });

  it('recognizes official brand SKU URLs without requiring review-site metadata', () => {
    const result = classifyPdp({
      url: 'https://www.adidas.com/us/hyperboost-edge-running-shoes/KI4392.html',
      title: 'Hyperboost Edge Running Shoes',
      expectedBrand: 'Adidas',
    });
    assert.equal(result.sourceTier, 'official');
    assert.equal(result.verdict, 'pdp');
    assert.ok(result.score >= 0.45);

    const campaign = classifyPdp({
      url: 'https://www.adidas.com/go/campaign/',
      title: 'Adidas Campaign',
      expectedBrand: 'Adidas',
    });
    assert.equal(campaign.verdict, 'uncertain');
  });

  it('marks review publishers as editorial even with PDP-like metadata', () => {
    const result = classifyPdp({
      url: 'https://believeintherun.com/shoe-reviews/adidas-hyperboost-edge/',
      title: 'Adidas Hyperboost Edge Review',
      expectedBrand: 'Adidas',
      metadata: {
        price: '120',
        productImage: 'https://believeintherun.com/image.jpg',
        merchantProductMetadata: true,
      },
    });
    assert.equal(result.sourceTier, 'editorial');
  });
});
