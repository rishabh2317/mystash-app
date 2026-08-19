import type { QueryIntent } from './types';

const CREATOR_HINTS = /\b(creator|influencer|youtuber|channel|@)\b/i;
const PRODUCT_MODEL =
  /\b(xm5|xm4|iphone|galaxy|pixel|airpods|macbook|ipad|watch|pro max|ultra)\b/i;
const COMPARISON = /\b(vs\.?|versus|compare|comparison)\b/i;
const COMMERCE = /\b(buy|deal|price|cheap|discount|shop|purchase)\b/i;
const TRENDING = /\b(trending|viral|popular now|what's hot)\b/i;
const DISCOVERY =
  /\b(best|ideas|outfits|gadgets|gifts|pack|minimalist|aesthetic|inspo|inspiration|things to)\b/i;
const CATEGORY =
  /\b(shoes|sneakers|bags|skincare|makeup|furniture|electronics|fashion|travel|home office)\b/i;

export type IntentResult = {
  intent: QueryIntent;
  /** Relative lane weights — Search service owns final blend. */
  laneWeights: { collection: number; creator: number; product: number };
};

/**
 * Deterministic / rule-based query intent — no LLM.
 */
export function detectQueryIntent(rawQuery: string): IntentResult {
  const q = rawQuery.trim();
  const lower = q.toLowerCase();

  if (COMPARISON.test(lower)) {
    return {
      intent: 'COMPARISON',
      laneWeights: { collection: 0.55, creator: 0.15, product: 0.3 },
    };
  }
  if (COMMERCE.test(lower)) {
    return {
      intent: 'COMMERCE',
      laneWeights: { collection: 0.35, creator: 0.1, product: 0.55 },
    };
  }
  if (TRENDING.test(lower)) {
    return {
      intent: 'TRENDING',
      laneWeights: { collection: 0.55, creator: 0.25, product: 0.2 },
    };
  }
  if (CREATOR_HINTS.test(lower) || /^@[\w.]+$/.test(q) || looksLikeHandle(lower)) {
    return {
      intent: 'CREATOR',
      laneWeights: { collection: 0.35, creator: 0.5, product: 0.15 },
    };
  }
  if (PRODUCT_MODEL.test(lower) || looksLikeExactProduct(lower)) {
    return {
      intent: 'EXACT_PRODUCT',
      laneWeights: { collection: 0.3, creator: 0.1, product: 0.6 },
    };
  }
  if (DISCOVERY.test(lower)) {
    return {
      intent: 'DISCOVERY',
      laneWeights: { collection: 0.6, creator: 0.2, product: 0.2 },
    };
  }
  if (CATEGORY.test(lower)) {
    return {
      intent: 'CATEGORY_CONCEPT',
      laneWeights: { collection: 0.5, creator: 0.2, product: 0.3 },
    };
  }
  // Default: Collection-primary discovery
  return {
    intent: 'DISCOVERY',
    laneWeights: { collection: 0.55, creator: 0.2, product: 0.25 },
  };
}

function looksLikeHandle(lower: string): boolean {
  const tokens = lower.split(/\s+/).filter(Boolean);
  return tokens.length === 1 && /^[a-z][a-z0-9._]{2,30}$/.test(tokens[0]!) && !PRODUCT_MODEL.test(tokens[0]!);
}

function looksLikeExactProduct(lower: string): boolean {
  // brand + model-ish tokens, short query
  const tokens = lower.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2 && tokens.length <= 5) {
    const hasDigits = tokens.some((t) => /\d/.test(t));
    const brands = ['sony', 'apple', 'nike', 'adidas', 'samsung', 'google', 'bose', 'dyson'];
    if (brands.some((b) => tokens.includes(b)) && (hasDigits || tokens.length >= 2)) {
      return true;
    }
  }
  return false;
}
