import React from 'react';
import type { AddToCartOutcome } from '@/src/services/productActionOrchestration';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { ProductCard, type ProductCardVariant } from '../ProductCard';

/** Thin wrapper — same ProductCard, no screen-specific chrome. */
export function SearchProductCard(props: {
  product: CatalogProductViewModel;
  isLight: boolean;
  onPress: (product: CatalogProductViewModel) => void;
  variant?: ProductCardVariant;
  onAddToCart?: (product: CatalogProductViewModel) => AddToCartOutcome | Promise<AddToCartOutcome>;
  onBuy?: (product: CatalogProductViewModel) => void;
}) {
  return <ProductCard {...props} />;
}
