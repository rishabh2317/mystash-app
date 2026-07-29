import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shortlistPdpCandidates } from './CandidateShortlister';

describe('CandidateShortlister', () => {
  it('separates metadata-only content from shopping-eligible PDPs', () => {
    const shortlisted = shortlistPdpCandidates(
      [
        {
          merchant: 'Believe in the Run',
          merchantUrl: 'https://believeintherun.com/adidas-hyperboost-edge-review',
          title: 'Adidas Hyperboost Edge Review',
          image: null,
          score: 0.95,
        },
        {
          merchant: 'Nike',
          merchantUrl: 'https://about.adidas.com/en/newsroom/releases/hyperboost-edge',
          title: 'Adidas Hyperboost Edge release',
          image: null,
          score: 0.94,
        },
        {
          merchant: 'Adidas',
          merchantUrl: 'https://www.adidas.com/us/hyperboost/KI4392.html',
          title: 'Adidas Hyperboost Edge',
          image: null,
          score: 0.9,
        },
        {
          merchant: 'Amazon',
          merchantUrl: 'https://www.amazon.com/dp/B0HYPER',
          title: 'Adidas Hyperboost Edge',
          image: null,
          score: 0.88,
        },
        {
          merchant: 'YouTube',
          merchantUrl: 'https://www.youtube.com/watch?v=x',
          title: 'Hyperboost review',
          image: null,
          score: 0.99,
        },
      ],
      { brand: 'Adidas', name: 'Hyperboost Edge KI4392', category: 'shoes' },
      5,
    );

    assert.ok(shortlisted.length >= 4);
    assert.ok(shortlisted.some((c) => /adidas\.com/i.test(c.merchantUrl)));
    assert.ok(shortlisted.some((c) => /amazon\.com/i.test(c.merchantUrl)));
    assert.ok(!shortlisted.some((c) => /youtube/i.test(c.merchantUrl)));

    const brandNews = shortlisted.find((c) => /about\.adidas/i.test(c.merchantUrl));
    assert.equal(brandNews?.candidatePageType, 'official_brand_news');
    assert.equal(brandNews?.shoppingEligible, false);

    const review = shortlisted.find((c) => /believeintherun/i.test(c.merchantUrl));
    assert.equal(review?.candidatePageType, 'review_site');
    assert.equal(review?.shoppingEligible, false);

    const officialProduct = shortlisted.find((c) => /adidas\.com/i.test(c.merchantUrl));
    assert.equal(officialProduct?.candidatePageType, 'official_product');
    assert.equal(officialProduct?.shoppingEligible, true);
  });
});
