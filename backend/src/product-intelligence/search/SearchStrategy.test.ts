import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SearchResult } from '../domain/types';
import type { ProductSearchProvider } from '../interfaces/ProductSearchProvider';
import { GoogleCustomSearchProvider } from './GoogleCustomSearchProvider';
import { SerperSearchProvider } from './SerperSearchProvider';
import { DefaultSearchStrategy } from './SearchStrategy';

describe('DefaultSearchStrategy', () => {
  it('returns Succeeded from first provider', async () => {
    const ok: ProductSearchProvider = {
      name: 'mock',
      async search(): Promise<SearchResult> {
        return {
          kind: 'Succeeded',
          provider: 'mock',
          candidates: [
            {
              merchant: 'shop.example',
              merchantUrl: 'https://shop.example/p/1',
              title: 'Bike',
              image: null,
              score: 0.8,
            },
          ],
        };
      },
    };
    const strat = new DefaultSearchStrategy([ok]);
    const r = await strat.search('bike');
    assert.equal(r.kind, 'Succeeded');
    if (r.kind === 'Succeeded') assert.equal(r.candidates.length, 1);
  });

  it('propagates Failed when provider fails', async () => {
    const fail: ProductSearchProvider = {
      name: 'mock',
      async search(): Promise<SearchResult> {
        return { kind: 'Failed', errorKind: 'quota', message: '429', provider: 'mock' };
      },
    };
    const r = await new DefaultSearchStrategy([fail]).search('x');
    assert.equal(r.kind, 'Failed');
    if (r.kind === 'Failed') assert.equal(r.errorKind, 'quota');
  });
});

describe('SerperSearchProvider', () => {
  it('returns auth Failed when key missing', async () => {
    const p = new SerperSearchProvider('');
    const r = await p.search('road bicycle');
    assert.equal(r.kind, 'Failed');
    if (r.kind === 'Failed') assert.equal(r.errorKind, 'auth');
  });

  it('classifies HTTP 429 as quota', async () => {
    const fetchImpl: typeof fetch = async () => new Response('rate', { status: 429 });
    const p = new SerperSearchProvider('k', undefined, 1000, 8, fetchImpl);
    const r = await p.search('bike');
    assert.equal(r.kind, 'Failed');
    if (r.kind === 'Failed') assert.equal(r.errorKind, 'quota');
  });

  it('classifies network errors', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('fetch failed');
    };
    const p = new SerperSearchProvider('k', undefined, 1000, 8, fetchImpl);
    const r = await p.search('bike');
    assert.equal(r.kind, 'Failed');
    if (r.kind === 'Failed') assert.equal(r.errorKind, 'network');
  });

  it('filters non-PDP links and maps candidates', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      assert.equal(typeof init?.method === 'string' ? init.method : 'GET', 'POST');
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers['X-API-KEY'], 'k');
      const body = JSON.parse(String(init?.body)) as { q: string; num: number };
      assert.equal(body.q, 'road bike');
      assert.equal(body.num, 8);
      return new Response(
        JSON.stringify({
          organic: [
            { title: 'Bike', link: 'https://www.google.com/search?q=bike', position: 1 },
            {
              title: 'Road Bike 500',
              link: 'https://merchant.example/products/road-bike',
              position: 2,
              imageUrl: 'https://img.example/b.jpg',
            },
          ],
        }),
        { status: 200 },
      );
    };
    const p = new SerperSearchProvider('k', undefined, 1000, 8, fetchImpl);
    const r = await p.search('road bike');
    assert.equal(r.kind, 'Succeeded');
    if (r.kind === 'Succeeded') {
      assert.equal(r.provider, 'serper');
      assert.equal(r.candidates.length, 1);
      assert.equal(r.candidates[0]!.merchantUrl, 'https://merchant.example/products/road-bike');
      assert.equal(r.candidates[0]!.image, null);
      assert.equal(r.candidates[0]!.merchant, 'merchant.example');
    }
  });
});

describe('GoogleCustomSearchProvider', () => {
  it('returns auth Failed when keys missing', async () => {
    const p = new GoogleCustomSearchProvider('', '');
    const r = await p.search('road bicycle');
    assert.equal(r.kind, 'Failed');
    if (r.kind === 'Failed') assert.equal(r.errorKind, 'auth');
  });

  it('filters non-PDP links and maps candidates', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          items: [
            { title: 'Bike', link: 'https://www.google.com/search?q=bike', displayLink: 'google.com' },
            {
              title: 'Road Bike 500',
              link: 'https://merchant.example/products/road-bike',
              displayLink: 'merchant.example',
              pagemap: { cse_image: [{ src: 'https://img.example/b.jpg' }] },
            },
          ],
        }),
        { status: 200 },
      );
    const p = new GoogleCustomSearchProvider('k', 'cx', undefined, 1000, fetchImpl);
    const r = await p.search('road bike');
    assert.equal(r.kind, 'Succeeded');
    if (r.kind === 'Succeeded') {
      assert.equal(r.candidates.length, 1);
      assert.equal(r.candidates[0]!.merchantUrl, 'https://merchant.example/products/road-bike');
    }
  });
});
