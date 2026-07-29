import type { CatalogProductViewModel } from '@/src/types/catalogProduct';

export type ProductDetailsActionId = 'replace' | 'refresh' | 'remove';

export type ProductDetailsActionConfig = {
  /** Which secondary actions to show on the details sheet. */
  enabled: ProductDetailsActionId[];
  onReplace?: (product: CatalogProductViewModel) => void;
  onRefresh?: (product: CatalogProductViewModel) => void;
  onRemove?: (product: CatalogProductViewModel) => void;
};

export const NO_PRODUCT_DETAILS_ACTIONS: ProductDetailsActionConfig = {
  enabled: [],
};
