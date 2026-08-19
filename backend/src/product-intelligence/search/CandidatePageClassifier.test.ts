import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { capabilitiesFor } from './CandidateCapabilityRegistry';
import { classifyCandidatePage } from './CandidatePageClassifier';

describe('CandidatePageClassifier', () => {
  it('separates source, page, and capabilities for official pages', () => {
    const product = classifyCandidatePage({
      url: 'https://www.nike.com/t/alphafly-3',
      sourceTier: 'official',
      title: 'Nike Alphafly 3',
    });
    const news = classifyCandidatePage({
      url: 'https://about.nike.com/en/newsroom/releases/alphafly-3',
      sourceTier: 'official',
      title: 'Nike introduces Alphafly 3',
    });

    assert.equal(product.sourceType, 'OFFICIAL');
    assert.equal(product.pageType, 'PRODUCT');
    assert.equal(product.capabilities.commerce, true);
    assert.equal(news.sourceType, 'OFFICIAL');
    assert.equal(news.pageType, 'NEWS');
    assert.equal(news.capabilities.metadata, true);
    assert.equal(news.capabilities.commerce, false);
  });

  it('classifies source from hostname independently of page type', () => {
    const comparison = classifyCandidatePage({
      url: 'https://www.gsmarena.com/compare.php3?idPhone1=1&idPhone2=2',
      title: 'Phone comparison',
    });
    const marketplaceSearch = classifyCandidatePage({
      url: 'https://www.amazon.com/search?q=phone',
      title: 'Search results',
      expectedBrand: 'Amazon',
    });

    assert.equal(comparison.sourceType, 'SPECIFICATION');
    assert.equal(comparison.pageType, 'COMPARISON');
    assert.equal(comparison.capabilities.specifications, true);
    assert.equal(marketplaceSearch.sourceType, 'MARKETPLACE');
    assert.equal(marketplaceSearch.pageType, 'SEARCH');
    assert.equal(marketplaceSearch.capabilities.metadata, false);
  });

  it('recognizes comparison hosts without relying on URL path conventions', () => {
    for (const url of [
      'https://versus.com/en/samsung-galaxy-s24-vs-samsung-galaxy-s25',
      'https://www.productchart.com/smartphones/',
    ]) {
      const comparison = classifyCandidatePage({ url });
      assert.equal(comparison.sourceType, 'SPECIFICATION');
      assert.equal(comparison.pageType, 'COMPARISON');
      assert.equal(comparison.capabilities.specifications, true);
      assert.equal(comparison.capabilities.commerce, false);
    }
  });

  it('treats buying guides as evidence-only for every source', () => {
    const guide = classifyCandidatePage({
      url: 'https://www.techradar.com/phones/buying-guide/best-phones',
      sourceTier: 'editorial',
    });

    assert.equal(guide.sourceType, 'REVIEW');
    assert.equal(guide.pageType, 'BUYING_GUIDE');
    assert.deepEqual(guide.capabilities, {
      metadata: false,
      commerce: false,
      specifications: false,
      images: false,
      evidence: true,
    });
  });

  it('keeps the capability matrix centralized', () => {
    assert.deepEqual(capabilitiesFor('FORUM', 'FORUM_THREAD'), {
      metadata: false,
      commerce: false,
      specifications: false,
      images: false,
      evidence: true,
    });
    assert.equal(capabilitiesFor('MARKETPLACE', 'PRODUCT').commerce, true);
    assert.equal(capabilitiesFor('MARKETPLACE', 'CATEGORY').commerce, false);
  });

  it('classifies Amazon short URLs as marketplace product pages', () => {
    for (const url of [
      'https://amzn.in/d/01fhRXW8',
      'https://amzn.in/d/0b57Rkqt',
      'https://amzn.com/d/abc123',
      'https://a.co/d/xyz789',
    ]) {
      const page = classifyCandidatePage({ url });
      assert.equal(page.sourceType, 'MARKETPLACE', url);
      assert.equal(page.pageType, 'PRODUCT', url);
      assert.equal(page.capabilities.commerce, true, url);
      assert.equal(page.capabilities.metadata, true, url);
    }
  });
});
