import React from 'react';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { ProductCard } from '../ProductCard';

/** Thin wrapper — same ProductCard, no screen-specific chrome. */
export function PublishedVideoProductCard(props: {
  product: CatalogProductViewModel;
  isLight: boolean;
  onPress: (product: CatalogProductViewModel) => void;
}) {
  return <ProductCard {...props} />;
}
