/**
 * Affiliate Wrapper Agent (plan): Cuelinks → Impact → branded fallback.
 * HTTP integrations for Cuelinks/Impact are not wired yet; this module
 * records the decision chain in logs and always returns a safe deep link.
 */

import { ingestLog } from './ingestLog.ts';

export type AffiliateResult = {
  affiliateUrl: string;
  provider: string;
  /** Which branch in the plan chain was selected (for audit). */
  chain: 'cuelinks' | 'impact' | 'fallback';
};

export type AffiliateWrapContext = {
  ingestId?: string;
  traceId?: string;
  index?: number;
};

function destinationHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid';
  }
}

export async function wrapAffiliateDestination(
  destinationUrl: string,
  ctx?: AffiliateWrapContext,
): Promise<AffiliateResult> {
  const host = destinationHost(destinationUrl);
  const cuelinksKey = Deno.env.get('CUELINKS_API_KEY');
  const impactSid = Deno.env.get('IMPACT_SITE_ID');

  const baseFields = {
    ingestId: ctx?.ingestId,
    traceId: ctx?.traceId,
    index: ctx?.index,
    destinationHost: host,
  };

  if (cuelinksKey) {
    ingestLog('warn', 'affiliate.cuelinks_key_present_api_not_wired', {
      ...baseFields,
      message: 'Set up Cuelinks HTTP shortlink API; using fallback link.',
    });
  } else {
    ingestLog('info', 'affiliate.cuelinks_skip_no_env', baseFields);
  }

  if (impactSid) {
    ingestLog('warn', 'affiliate.impact_env_present_api_not_wired', {
      ...baseFields,
      message: 'Set up Impact deep link API; using fallback link.',
    });
  } else {
    ingestLog('info', 'affiliate.impact_skip_no_env', baseFields);
  }

  const encoded = encodeURIComponent(destinationUrl);
  return {
    affiliateUrl: `https://mystash.go.link/?d=${encoded}`,
    provider: 'fallback',
    chain: 'fallback',
  };
}
