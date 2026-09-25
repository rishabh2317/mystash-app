import { SafeHttpError, safeFetch } from '../../pipeline/safeHttp';
import { extractEmbeddedStatePrice } from '../extract/embeddedState';
import { extractJsonLdPrice } from '../extract/jsonLd';
import { extractMetaPrice } from '../extract/metaTags';
import type { MerchantPriceFetchResult } from '../types';
import { successResult, type MerchantPricingAdapter, type MerchantPricingAdapterContext } from './types';

async function loadHtml(ctx: MerchantPricingAdapterContext): Promise<{
  status: number;
  body: string;
  blocked?: boolean;
}> {
  if (ctx.fetchHtml) return ctx.fetchHtml(ctx.url);
  try {
    const res = await safeFetch(ctx.url, {
      timeoutMs: ctx.timeoutMs,
      maxBytes: ctx.maxBytes,
      maxRedirects: ctx.maxRedirects,
    });
    if (res.status === 403 || res.status === 401 || res.status === 429) {
      return { status: res.status, body: '', blocked: true };
    }
    if (res.status >= 400) {
      return { status: res.status, body: '' };
    }
    return { status: res.status, body: await res.text() };
  } catch (e) {
    if (e instanceof SafeHttpError) {
      if (e.code === 'TIMEOUT') {
        return { status: 0, body: '', blocked: false };
      }
      if (e.code === 'PRIVATE_DESTINATION' || e.code === 'UNSUPPORTED_SCHEME') {
        return { status: 0, body: '', blocked: true };
      }
    }
    throw e;
  }
}

/**
 * Cheap primary path: direct HTTP + deterministic structured extraction.
 * Order: JSON-LD → meta tags → embedded product state.
 */
export function createHttpStructuredAdapter(): MerchantPricingAdapter {
  return {
    name: 'http-structured',
    async tryExtract(ctx): Promise<MerchantPriceFetchResult | null> {
      let loaded: { status: number; body: string; blocked?: boolean };
      try {
        loaded = await loadHtml(ctx);
      } catch (e) {
        if (e instanceof SafeHttpError && e.code === 'TIMEOUT') {
          return {
            status: 'timeout',
            price: null,
            currency: null,
            availability: null,
            fetchedAt: new Date().toISOString(),
          };
        }
        if (e instanceof SafeHttpError) {
          return {
            status: 'blocked',
            price: null,
            currency: null,
            availability: null,
            fetchedAt: new Date().toISOString(),
          };
        }
        return {
          status: 'invalid',
          price: null,
          currency: null,
          availability: null,
          fetchedAt: new Date().toISOString(),
        };
      }

      if (loaded.blocked) {
        return {
          status: 'blocked',
          price: null,
          currency: null,
          availability: null,
          fetchedAt: new Date().toISOString(),
        };
      }

      if (loaded.status === 0) {
        return {
          status: 'timeout',
          price: null,
          currency: null,
          availability: null,
          fetchedAt: new Date().toISOString(),
        };
      }

      if (!loaded.body) {
        return {
          status: 'unavailable',
          price: null,
          currency: null,
          availability: null,
          fetchedAt: new Date().toISOString(),
        };
      }

      const extracted =
        extractJsonLdPrice(loaded.body) ??
        extractMetaPrice(loaded.body) ??
        extractEmbeddedStatePrice(loaded.body);

      if (!extracted) {
        return {
          status: 'invalid',
          price: null,
          currency: null,
          availability: null,
          fetchedAt: new Date().toISOString(),
        };
      }

      return successResult(extracted);
    },
  };
}
