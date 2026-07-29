import { curationLog } from '@/src/logging/curationLog';

type ProductAnalyticsEvent =
  | 'product.card.viewed'
  | 'product.card.opened'
  | 'product.details.viewed'
  | 'product.view_product.clicked'
  | 'product.replaced'
  | 'product.removed'
  | 'product.metadata.refreshed';

export function trackProductEvent(
  event: ProductAnalyticsEvent,
  fields: Record<string, string | number | boolean | null | undefined> = {},
): void {
  curationLog('info', event, { surface: 'commerce', ...fields });
}
