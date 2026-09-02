import { ProductDetailsSheet } from '@/components/commerce';
import { useProductAddToCartHandler } from '@/src/services/productActionOrchestration';
import { openProductShopping } from '@/src/services/shoppingClick';
import { mapFeedProductToCatalogViewModel } from '@/src/mappers/feedProductMapper';
import type { Product, Video } from '@/src/mocks/videos';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import React, { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';

type Props = {
  video: Video | null;
  product: Product | null;
  visible: boolean;
  onClose: () => void;
};

/**
 * Home / focused-reel product inspect. Sheet owns UI; parent owns Bag/Buy.
 * Never selects merchant URLs on the client.
 */
export function FeedProductSheet({ video, product, visible, onClose }: Props) {
  const onAddToCart = useProductAddToCartHandler();
  const viewModel = useMemo(
    () => (product ? mapFeedProductToCatalogViewModel(product) : null),
    [product],
  );
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
