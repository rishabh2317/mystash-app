import { logger } from '../logger';
import type { LivePriceStatus } from './types';

export type PricingMetric = {
  status: LivePriceStatus;
  adapter?: string | null;
  merchant?: string | null;
  country?: string | null;
};

export function recordPricingMetric(event: PricingMetric): void {
  logger.info(
    {
      status: event.status,
      adapter: event.adapter ?? null,
      merchant: event.merchant ?? null,
      country: event.country ?? null,
    },
    'merchant_pricing.fetch',
  );
}
