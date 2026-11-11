import { readFindOutcome } from './validation';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FindMembershipCounts, FindReportSnapshot } from './outcome';

type MembershipRow = { discovery_products?: number; import_id: string; saved_products: number; saved_places: number;
  missing_products: number; missing_places: number; found_products: number; found_places: number; resolved_places: number; unverified_places: number; report: FindReportSnapshot; outcome: unknown; selected_products: FindMembershipCounts['selectedProducts'] };
export async function readFindMemberships(db: SupabaseClient, userId: string, ids: string[]): Promise<Map<string, FindMembershipCounts>> {
  if (!ids.length) return new Map();
  const { data, error } = await db.rpc('find_outcome_memberships', { p_user: userId, p_imports: ids }).abortSignal(AbortSignal.timeout(25_000));
  if (error || !Array.isArray(data)) throw new Error('Find membership reporting unavailable');
  return new Map(data.map((r: MembershipRow) => {
    const counts = [r.discovery_products ?? 0,r.found_products, r.found_places, r.saved_products, r.saved_places, r.missing_products, r.missing_places, r.resolved_places, r.unverified_places];
    if (counts.some(n => !Number.isSafeInteger(n) || n < 0) || r.resolved_places + r.unverified_places !== r.found_places || !Array.isArray(r.selected_products) || r.selected_products.some(p => !p || typeof p.productId !== 'string' || typeof p.title !== 'string' || (p.imageUrl !== null && typeof p.imageUrl !== 'string')) || !r.report || typeof r.report.startedAt !== 'string'
      || !('source' in r.report) || !('progress' in r.report) || !('syncState' in r.report) || !('syncAttemptId' in r.report)) {
      throw new Error('Incompatible Find membership snapshot');
    }
    return [r.import_id, { discoveryProducts:r.discovery_products??0, outcome: readFindOutcome(r.outcome), selectedProducts: r.selected_products, snapshot: r.report, foundProducts: r.found_products, foundPlaces: r.found_places,
      resolvedPlaces: r.resolved_places, unverifiedPlaces: r.unverified_places, savedProducts: r.saved_products, savedPlaces: r.saved_places, missingProducts: r.missing_products, missingPlaces: r.missing_places }];
  }));
}
