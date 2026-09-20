import { hydrateProductPage } from '@/src/services/productPageMap';
import type { ProductPageView } from '@/src/types/productPage';

export class ProductPageApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ProductPageApiError';
  }
}

function apiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) {
    throw new ProductPageApiError('Mystash product service is not configured.', 500);
  }
  return base;
}

export async function fetchProductPage(
  productId: string,
  attrs?: { contentSourceId?: string | null; userImportId?: string | null },
): Promise<ProductPageView> {
  const id = productId.trim();
  if (!id) throw new ProductPageApiError('Product id is required', 400);
  const query = new URLSearchParams();
  if (attrs?.contentSourceId?.trim()) query.set('contentSourceId', attrs.contentSourceId.trim());
  if (attrs?.userImportId?.trim()) query.set('userImportId', attrs.userImportId.trim());
  const suffix = query.toString();
  const res = await fetch(
    `${apiBase()}/products/${encodeURIComponent(id)}/page${suffix ? `?${suffix}` : ''}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) {
    throw new ProductPageApiError(
      res.status === 404 ? 'Product not found' : `Product request failed (${res.status})`,
      res.status,
    );
  }
  const page = hydrateProductPage(await res.json());
  if (!page) throw new ProductPageApiError('Product data was incomplete.', 500);
  return page;
}
