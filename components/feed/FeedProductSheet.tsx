import { ProductDetailsSheet } from '@/components/commerce';
import { mapFeedProductToCatalogViewModel } from '@/src/mappers/feedProductMapper';
import type { Product, Video } from '@/src/mocks/videos';
import { catalogRowToViewModel } from '@/src/services/catalogProductMapper';
import { useProductAddToCartHandler } from '@/src/services/productActionOrchestration';
import { openProductShopping } from '@/src/services/shoppingClick';
import { fetchCatalogProductsByIds } from '@/src/services/supabase';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';

type Props = {
  video: Video | null;
  product: Product | null;
  visible: boolean;
  onClose: () => void;
};

/**
 * Home / focused-reel product inspect. Sheet owns UI; parent owns Bag/Buy.
 * Hydrates from Catalog SoT when `catalog_product_id` is present so details
 * are not limited to the thin feed chip payload.
 */
export function FeedProductSheet({ video, product, visible, onClose }: Props) {
  const onAddToCart = useProductAddToCartHandler();
  const thin = useMemo(
    () => (product ? mapFeedProductToCatalogViewModel(product) : null),
    [product],
  );
  const [hydrated, setHydrated] = useState<CatalogProductViewModel | null>(null);

  useEffect(() => {
    if (!visible || !product) {
      setHydrated(null);
      return;
    }
    const catalogId = product.catalog_product_id?.trim();
    if (!catalogId) {
      setHydrated(null);
      return;
    }
    let cancelled = false;
    void fetchCatalogProductsByIds([catalogId])
      .then((rows) => {
        if (cancelled) return;
        const row = rows.get(catalogId);
        setHydrated(row ? catalogRowToViewModel(row) : null);
      })
      .catch(() => {
        if (!cancelled) setHydrated(null);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, product]);

  const viewModel = useMemo(() => {
    if (hydrated) {
      if ((!hydrated.price || hydrated.price === '—') && thin?.price) {
        return { ...hydrated, price: thin.price };
      }
      return hydrated;
    }
    return thin;
  }, [hydrated, thin]);
  const shopable = Boolean(viewModel?.catalogProductId);

  const onBuy = useCallback(
    async (next: CatalogProductViewModel) => {
      if (!next.catalogProductId) {
        Alert.alert('Link unavailable', 'No shopping destination is available for this product yet.');
        return;
      }
      try {
        await openProductShopping({
          catalogProductId: next.catalogProductId,
          collectionId: video?.collection_id ?? null,
          videoId: video?.id ?? null,
          creatorId: video?.curator_id ?? null,
        });
      } catch {
        Alert.alert('Error', 'Could not open the product link.');
      }
    },
    [video],
  );

  return (
    <ProductDetailsSheet
      visible={visible}
      product={viewModel}
      onClose={onClose}
      onAddToCart={shopable ? onAddToCart : undefined}
      onBuy={shopable ? onBuy : undefined}
    />
  );
}
