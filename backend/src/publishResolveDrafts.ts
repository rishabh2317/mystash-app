import type { SupabaseClient } from '@supabase/supabase-js';

export type DraftProductRow = {
  external_id: string;
  name: string;
  price: string;
  image: string | null;
  affiliate_url: string | null;
  provider: string | null;
};

export type ResolveDraftsResult = {
  drafts: DraftProductRow[];
  /** How many `ingest_draft_products` rows exist for this ingest */
  totalDraftRows: number;
  /** Normalized selected ids that had no row with the same `external_id` */
  unmatchedSelectedIds: string[];
};

/**
 * Loads all draft products for an ingest and matches `selectedProductIds` to `external_id`
 * (same string the app shows as `DraftProduct.id`). Order follows `selectedProductIds`.
 */
export async function resolveSelectedDraftProducts(
  admin: SupabaseClient,
  ingestId: string,
  selectedProductIds: string[],
): Promise<ResolveDraftsResult> {
  const selectedNorm = [...new Set(selectedProductIds.map((s) => String(s).trim()).filter(Boolean))];
  if (selectedNorm.length === 0) {
    return { drafts: [], totalDraftRows: 0, unmatchedSelectedIds: [] };
  }

  const { data: allRows, error } = await admin
    .from('ingest_draft_products')
    .select('external_id, name, price, image, affiliate_url, provider')
    .eq('ingest_request_id', ingestId);

  if (error) {
    throw new Error(error.message);
  }

  const byExt = new Map<string, DraftProductRow>();
  for (const r of allRows ?? []) {
    const ext = String((r as DraftProductRow).external_id ?? '').trim();
    if (ext) byExt.set(ext, r as DraftProductRow);
  }

  const drafts: DraftProductRow[] = [];
  for (const id of selectedNorm) {
    const row = byExt.get(id);
    if (row) drafts.push(row);
  }

  const unmatchedSelectedIds = selectedNorm.filter((id) => !byExt.has(id));

  return {
    drafts,
    totalDraftRows: byExt.size,
    unmatchedSelectedIds,
  };
}
