import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentSourcePlaceRecord } from '../domain/types';
import { SupabasePlaceRepository } from '../SupabasePlaceRepository';
import { decidePlaceMention } from '../decidePlaceMention';
import { placeMaySearch } from '../placeMaySearch';
import { searchPlacesWithTimeout, DEFAULT_PLACE_SEARCH_TIMEOUT_MS, type PlaceSearchProvider } from '../PlaceSearchProvider';
import { PlacePhotoService } from './PlacePhotoService';
import type { PlacePhotoProvider } from './GooglePlacePhotoProvider';

export type OwnedPhotoLead = (user: string, id: string, importId?: string) => Promise<ContentSourcePlaceRecord | null>;

/** Authorize existing personal membership or an owned, visible Find. No writes. */
export function supabaseOwnedPhotoLead(db: SupabaseClient): OwnedPhotoLead {
  const places = new SupabasePlaceRepository(db);
  return async (user, id, importId) => {
    const lead = await places.findHypothesisById(id);
    if (!lead || lead.retiredAt) return null;
    const save = await places.findSaveByUserAndHypothesis(user, id);
    if (save && !save.removedAt) return lead;
    if (!importId) return null;
    const imported = await db.from('user_imports').select('content_source_id').eq('id', importId)
      .eq('user_id', user).is('hidden_at', null).maybeSingle();
    if (imported.error) throw new Error('place_photo_access_unavailable');
    return imported.data?.content_source_id === lead.contentSourceId ? lead : null;
  };
}

/** Display-only lookup: an image never verifies a lead or creates canonical rows. */
export class PlaceLeadPhotoService {
  private readonly photos: PlacePhotoService;
  private readonly budgets = new Map<string, { since: number; count: number }>();
  private readonly cooldowns = new Map<string, number>();
  // Short-lived provider IDs only, scoped to owner and unchanged evidence. No photo metadata/bytes.
  private readonly selections = new Map<string, { context: string; providerPlaceId: string; until: number }>();
  private readonly pending = new Map<string, Promise<{ provider: string; providerPlaceId: string } | null>>();

  constructor(owned: OwnedPhotoLead, search: PlaceSearchProvider, provider: PlacePhotoProvider, now = Date.now) {
    this.photos = new PlacePhotoService(async (user, id, importId) => {
      const lead = await owned(user, id, importId);
      if (!lead || lead.retiredAt) return null;
      const mention = { ...lead, name: lead.extractedName };
      if (!placeMaySearch(mention)) return null;
      const key = `${user}:${id}`;
      const context = createHash('sha256').update(JSON.stringify([lead.extractedName, lead.locality, lead.city, lead.region, lead.country, lead.category, lead.mentionedAddress, lead.evidence])).digest('hex');
      const current = this.pending.get(`${key}:${context}`);
      if (current) return current;
      const time = now();
      for (const [k, value] of this.selections) if (value.until <= time) this.selections.delete(k);
      const selected = this.selections.get(key);
      if (selected?.context === context) return { provider: 'google', providerPlaceId: selected.providerPlaceId };
      for (const [k, until] of this.cooldowns) if (until <= time) this.cooldowns.delete(k);
      for (const [k, value] of this.budgets) if (time - value.since >= 60000) this.budgets.delete(k);
      const budget = this.budgets.get(user) ?? { since: time, count: 0 };
      // Bound extra discovery separately from the existing photo budget. No retry loop.
      if ((this.cooldowns.get(key) ?? 0) > time || budget.count >= 6 || this.pending.size >= 3
        || this.cooldowns.size >= 1000 || this.selections.size >= 1000 || this.budgets.size >= 1000 && !this.budgets.has(user)) return null;
      budget.count++; this.budgets.set(user, budget); this.cooldowns.set(key, time + 60000);
      const work = (async () => {
        const decision = await decidePlaceMention(mention, query => searchPlacesWithTimeout(search, query, DEFAULT_PLACE_SEARCH_TIMEOUT_MS));
        if (decision.outcome !== 'resolved') return null;
        this.selections.set(key, { context, providerPlaceId: decision.providerPlaceId, until: time + 60000 });
        return { provider: 'google', providerPlaceId: decision.providerPlaceId };
      })();
      this.pending.set(`${key}:${context}`, work);
      try { return await work; } finally { this.pending.delete(`${key}:${context}`); }
    }, provider, now);
  }

  read(user: string, id: string, width: number, importId?: string) {
    return this.photos.read(user, id, width, importId);
  }
}
