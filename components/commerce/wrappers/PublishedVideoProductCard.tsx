import React from 'react';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { ProductCard, type ProductCardVariant } from '../ProductCard';

/** Thin wrapper — same ProductCard, no screen-specific chrome. */
export function PublishedVideoProductCard(props: {
  product: CatalogProductViewModel;
  isLight: boolean;
  onPress: (product: CatalogProductViewModel) => void;
  variant?: ProductCardVariant;
  onAddToCart?: (product: CatalogProductViewModel) => void;
  onBuy?: (product: CatalogProductViewModel) => void;
}) {
  return <ProductCard {...props} />;
}
