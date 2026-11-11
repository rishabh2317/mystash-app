import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlaceRecord } from '../domain/types';
import { SupabasePlaceRepository } from '../SupabasePlaceRepository';
import { PlacePhotoError, type PlacePhotoProvider } from './GooglePlacePhotoProvider';
import type { PlaceImageResponse } from './contract';

export type OwnedPhotoPlace = (user: string, id: string, importId?: string) => Promise<PlaceRecord | null>;

/** Reuse canonical identity. This authorization path performs SELECTs only. */
export function supabaseOwnedPhotoPlace(db: SupabaseClient): OwnedPhotoPlace {
  const places = new SupabasePlaceRepository(db);
  return async (user,id,importId) => {
    const save = await places.findSaveByUserAndPlace(user,id);
    if (!save || save.removedAt) {
      if (!importId) return null;
      const imported = await db.from('user_imports').select('content_source_id').eq('id',importId).eq('user_id',user).is('hidden_at',null).maybeSingle();
      if (imported.error) throw new Error('place_photo_access_unavailable');
      if (!imported.data?.content_source_id) return null;
      const source = await db.from('content_source_places').select('id').eq('content_source_id',imported.data.content_source_id)
        .eq('place_id',id).eq('resolution_state','resolved').is('retired_at',null).limit(1).maybeSingle();
      if (source.error) throw new Error('place_photo_access_unavailable');
      if (!source.data) return null;
    }
    return places.findPlaceById(id);
  };
}

export class PlacePhotoService {
  private readonly budgets = new Map<string,{ since:number; count:number }>();
  constructor(private readonly owned: OwnedPhotoPlace, private readonly provider: PlacePhotoProvider, private readonly now = Date.now) {}
  async read(user: string, id: string, width: number, importId?: string): Promise<PlaceImageResponse | null> {
    const place = await this.owned(user,id,importId);
    if (!place) return null; // Route returns the same 404 for all inaccessible identities.
    if (place.provider !== 'google') return { image:null };
    const now = this.now();
    for (const [key,value] of this.budgets) if (now-value.since >= 60000) this.budgets.delete(key);
    const budget = this.budgets.get(user) ?? { since:now,count:0 };
    if (budget.count >= 60 || this.budgets.size >= 1000 && !this.budgets.has(user)) return { image:null, failure:'rate_limit', retryAfterMs:60000 };
    budget.count++; this.budgets.set(user,budget);
    try { return { image: await this.provider.photo(place.providerPlaceId,width), googlePlaceId:place.providerPlaceId }; }
    catch (error) { return { image:null, failure:error instanceof PlacePhotoError ? error.kind : 'transient', retryAfterMs:error instanceof PlacePhotoError ? error.retryAfterMs : 0 }; }
  }
}
