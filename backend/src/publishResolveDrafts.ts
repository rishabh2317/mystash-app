import type { SupabaseClient } from '@supabase/supabase-js';

export type DraftProductRow = {
  id: string;
  external_id: string;
  name: string;
  price: string;
  image: string | null;
  merchant_url: string | null;
  affiliate_url: string | null;
  provider: string | null;
  catalog_product_id: string | null;
  resolution_status: string | null;
};

export type ResolveDraftsResult = {
  drafts: DraftProductRow[];
  totalDraftRows: number;
  unmatchedSelectedIds: string[];
};

/**
 * Loads draft products and matches selectedProductIds to external_id.
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
    .select(
      'id, external_id, name, price, image, merchant_url, affiliate_url, provider, catalog_product_id, resolution_status',
    )
    .eq('ingest_request_id', ingestId);

  if (error) {
    throw new Error(error.message);
  }

  const byExt = new Map<string, DraftProductRow>();
  for (const r of allRows ?? []) {
    const row = r as DraftProductRow;
    const ext = String(row.external_id ?? '').trim();
    if (ext) byExt.set(ext, row);
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
