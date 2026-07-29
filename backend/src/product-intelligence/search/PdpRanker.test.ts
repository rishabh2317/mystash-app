import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SearchCandidate } from '../domain/types';
import { pickBestPdpUrl, rankPdpCandidates, scorePdpCandidate } from './PdpRanker';

function c(partial: Partial<SearchCandidate> & { merchantUrl: string }): SearchCandidate {
  return {
    merchant: partial.merchant ?? null,
    merchantUrl: partial.merchantUrl,
    title: partial.title ?? 'Product',
    image: null,
    score: partial.score ?? 0.7,
  };
}

describe('PdpRanker', () => {
  it('prefers official brand domain over marketplaces and social', () => {
    const hints = { brand: 'Apple', name: 'MacBook Air M4', category: 'laptops' };
    const apple = c({
      merchantUrl: 'https://www.apple.com/in/macbook-air/',
      title: 'MacBook Air M4 - Apple',
      merchant: 'apple.com',
    });
    const amazon = c({
      merchantUrl: 'https://www.amazon.in/dp/B0TEST',
      title: 'Apple MacBook Air M4',
      merchant: 'amazon.in',
    });
    const yt = c({
      merchantUrl: 'https://www.youtube.com/watch?v=abc',
      title: 'MacBook Air M4 Review',
      merchant: 'youtube.com',
    });
    const reddit = c({
      merchantUrl: 'https://www.reddit.com/r/apple/comments/x',
      title: 'MacBook discussion',
      merchant: 'reddit.com',
    });

    assert.ok(scorePdpCandidate(apple, hints) > scorePdpCandidate(amazon, hints));
    assert.equal(scorePdpCandidate(yt, hints), Number.NEGATIVE_INFINITY);
    assert.equal(scorePdpCandidate(reddit, hints), Number.NEGATIVE_INFINITY);

    const best = pickBestPdpUrl([reddit, yt, amazon, apple], hints);
    assert.equal(best?.merchantUrl, apple.merchantUrl);
  });

  it('ranks Flipkart and Amazon equally preferred over blogs', () => {
    const hints = { brand: 'Sony', name: 'WH-1000XM5', category: 'headphones' };
    const ranked = rankPdpCandidates(
      [
        c({ merchantUrl: 'https://medium.com/@x/sony-review', title: 'Sony WH-1000XM5' }),
        c({ merchantUrl: 'https://www.flipkart.com/sony-xm5/p/itm', title: 'Sony WH-1000XM5' }),
        c({ merchantUrl: 'https://www.amazon.in/Sony-WH-1000XM5/dp/x', title: 'Sony WH-1000XM5' }),
      ],
      hints,
    );
    assert.match(ranked[0]!.merchantUrl, /(amazon|flipkart)/i);
    assert.match(ranked[1]!.merchantUrl, /(amazon|flipkart)/i);
    assert.equal(ranked.length, 2);
  });

  it('orders official merchants before editorial review publishers', () => {
    const ranked = rankPdpCandidates(
      [
        c({
          merchantUrl: 'https://believeintherun.com/adidas-hyperboost-edge-review',
          title: 'Adidas Hyperboost Edge Review with price',
          score: 0.99,
        }),
        c({
          merchantUrl: 'https://www.adidas.com/us/hyperboost-edge-running-shoes/KI4392.html',
          title: 'Hyperboost Edge Running Shoes',
          score: 0.6,
        }),
      ],
      { brand: 'Adidas', name: 'Hyperboost Edge Running Shoes', category: 'shoes' },
    );
    assert.equal(ranked[0]?.sourceTier, 'official');
    assert.match(ranked[0]?.merchantUrl ?? '', /adidas\.com/);
    assert.equal(ranked[1]?.sourceTier, 'editorial');
  });
});
