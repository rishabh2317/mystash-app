import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { isPubliclyRoutableAddress } from '../user-import/domain/hostSafety';
import { SAFE_FETCH_MAX_BYTES, SafeHttpError, safeFetch } from './safeHttp';

const originalFetch = globalThis.fetch;

describe('safeFetch', { concurrency: false }, () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects non-http schemes', async () => {
    await assert.rejects(
      () => safeFetch('ftp://example.com/file'),
      (err: unknown) => err instanceof SafeHttpError && err.code === 'UNSUPPORTED_SCHEME',
    );
  });

  it('rejects loopback and private hosts before connecting', async () => {
    globalThis.fetch = (async () => {
      throw new Error('fetch should not run');
    }) as typeof fetch;

    await assert.rejects(
      () => safeFetch('http://127.0.0.1/secret'),
      (err: unknown) => err instanceof SafeHttpError && err.code === 'PRIVATE_DESTINATION',
    );
    await assert.rejects(
      () => safeFetch('http://localhost/admin'),
      (err: unknown) => err instanceof SafeHttpError && err.code === 'PRIVATE_DESTINATION',
    );
    await assert.rejects(
      () => safeFetch('http://169.254.169.254/latest/meta-data/'),
      (err: unknown) => err instanceof SafeHttpError && err.code === 'PRIVATE_DESTINATION',
    );
  });

  it('rejects DNS rebinding onto a private address', async () => {
    globalThis.fetch = (async () => {
      throw new Error('fetch should not run');
    }) as typeof fetch;

    await assert.rejects(
      () =>
        safeFetch('https://shop.example.com/p/mug', {
          resolver: async () => ['127.0.0.1'],
        }),
      (err: unknown) => err instanceof SafeHttpError && err.code === 'PRIVATE_DESTINATION',
    );
  });

  it('re-checks the destination after a redirect', async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === 'https://shop.example.com/p/mug') {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/steal' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    await assert.rejects(
      () =>
        safeFetch('https://shop.example.com/p/mug', {
          resolver: async (hostname) => {
            if (hostname === 'shop.example.com') return ['93.184.216.34'];
            return ['127.0.0.1'];
          },
        }),
      (err: unknown) => err instanceof SafeHttpError && err.code === 'PRIVATE_DESTINATION',
    );
  });

  it('bounds redirects', async () => {
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://shop.example.com/next' },
      })) as typeof fetch;

    await assert.rejects(
      () =>
        safeFetch('https://shop.example.com/start', {
          maxRedirects: 2,
          resolver: async () => ['93.184.216.34'],
        }),
      (err: unknown) => err instanceof SafeHttpError && err.code === 'REDIRECT_LIMIT',
    );
  });

  it('truncates oversized responses', async () => {
    const body = 'x'.repeat(SAFE_FETCH_MAX_BYTES + 50);
    globalThis.fetch = (async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;

    const res = await safeFetch('https://shop.example.com/p/mug', {
      resolver: async () => ['93.184.216.34'],
      maxBytes: 100,
    });
    const text = await res.text();
    assert.equal(text.length, 100);
    assert.equal(res.status, 200);
  });

  it('times out a hung request', async () => {
    globalThis.fetch = (async (_input, init) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
      return new Response('late');
    }) as typeof fetch;

    await assert.rejects(
      () =>
        safeFetch('https://shop.example.com/p/mug', {
          resolver: async () => ['93.184.216.34'],
          timeoutMs: 20,
        }),
      (err: unknown) => err instanceof SafeHttpError && err.code === 'TIMEOUT',
    );
  });
});

describe('isPubliclyRoutableAddress', () => {
  it('rejects loopback, private, link-local and metadata addresses', () => {
    assert.equal(isPubliclyRoutableAddress('127.0.0.1'), false);
    assert.equal(isPubliclyRoutableAddress('10.0.0.1'), false);
    assert.equal(isPubliclyRoutableAddress('192.168.1.1'), false);
    assert.equal(isPubliclyRoutableAddress('169.254.169.254'), false);
    assert.equal(isPubliclyRoutableAddress('::1'), false);
    assert.equal(isPubliclyRoutableAddress('::ffff:127.0.0.1'), false);
  });

  it('accepts a public IPv4 address', () => {
    assert.equal(isPubliclyRoutableAddress('93.184.216.34'), true);
  });
});
