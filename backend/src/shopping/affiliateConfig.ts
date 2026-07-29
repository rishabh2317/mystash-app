import { getEnv } from '../env';

export type AffiliateConfig = {
  enabled: boolean;
  provider: string;
};

/** The only source of affiliate enablement/provider configuration. */
export function getAffiliateConfig(): AffiliateConfig {
  return {
    enabled: (getEnv('AFFILIATE_ENABLED') ?? 'false').trim().toLowerCase() === 'true',
    provider: getEnv('AFFILIATE_PROVIDER')?.trim().toLowerCase() || 'none',
  };
}
