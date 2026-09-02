import { catalogRowToViewModel } from '@/src/services/catalogProductMapper';
import type { SearchResultCard } from '@/src/services/searchApi';
import { fetchCatalogProductsByIds } from '@/src/services/supabase';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { mapSearchProductCardThin } from '@/src/mappers/searchMapper';

/** Hydrate product hits from Catalog SoT; fall back to thin card map. */
export async function hydrateSearchProducts(
  cards: SearchResultCard[],
): Promise<CatalogProductViewModel[]> {
  const productCards = cards.filter((c) => c.entityType === 'product' && c.id.trim());
  if (productCards.length === 0) return [];
  const ids = productCards.map((c) => c.id.trim());
  const rows = await fetchCatalogProductsByIds(ids);
  const out: CatalogProductViewModel[] = [];
  for (const card of productCards) {
    const row = rows.get(card.id.trim());
    if (row) {
      const hydrated = catalogRowToViewModel(row);
      if ((!hydrated.price || hydrated.price === '—') && card.price?.trim()) {
        hydrated.price = card.price.trim();
        hydrated.currency = card.priceCurrency?.trim() || hydrated.currency;
      }
      if (!hydrated.shortDescription && card.matchReason) {
        hydrated.shortDescription = card.matchReason;
      }
      out.push(hydrated);
      continue;
    }
    const thin = mapSearchProductCardThin(card);
    if (thin) out.push(thin);
  }
  return out;
}
