import '@/src/polyfills/installCryptoForAuth';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Product, Video } from '@/src/mocks/videos';
import { mapVideoRow } from '@/src/mappers/videoRowMapper';
import type { CatalogProductRow } from '@/src/types/catalogProduct';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

/** AsyncStorage is required so PKCE `code_verifier` survives until `exchangeCodeForSession` (Google OAuth on device). */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

export interface DatabaseVideo {
  id: string;
  url: string;
  thumbnail: string;
  creator_name: string;
  stash_score: number;
  product_name: string;
  embed_url?: string;
  video_title?: string;
  curator_id?: string;
  collection_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

type CatalogJoin = {
  id: string;
  name: string;
  brand?: string | null;
  price: string | null;
  image_url: string | null;
  merchant: string | null;
  verification_status: string | null;
  description?: string | null;
  availability?: string | null;
  last_verified_at?: string | null;
  currency?: string | null;
  metadata?: Record<string, unknown> | null;
};

type VideoProductRow = {
  id: string;
  video_id: string;
  sort_order: number;
  catalog_product_id: string | null;
  /** Legacy denormalized cache — only used when catalog join is missing. */
  name?: string;
  price?: string;
  image?: string | null;
  provider?: string | null;
  catalog_products?: CatalogJoin | CatalogJoin[] | null;
};

function unwrapCatalog(row: VideoProductRow): CatalogJoin | null {
  const c = row.catalog_products;
  if (!c) return null;
  return Array.isArray(c) ? c[0] ?? null : c;
}

/** Map UI product exclusively from catalog_products when linked. */
function mapRowToProduct(row: VideoProductRow): Product {
  const cat = unwrapCatalog(row);
  if (cat) {
    return {
      // UI/list identity belongs to the video_products relation. Multiple
      // rows may legitimately reference the same catalog product.
      id: row.id,
      name: cat.name,
      price: cat.price || '—',
      image: cat.image_url || 'https://picsum.photos/seed/product/200/200',
      provider: cat.merchant ?? undefined,
      catalog_product_id: cat.id,
    };
  }
  // Legacy rows without catalog FK — still never call external providers at read time.
  return {
    id: row.id,
    name: row.name || 'Product',
    price: row.price || '—',
    image: row.image || 'https://picsum.photos/seed/product/200/200',
    provider: row.provider ?? undefined,
    catalog_product_id: row.catalog_product_id ?? undefined,
  };
}

async function fetchProductsForVideos(videoIds: string[]): Promise<Map<string, Product[]>> {
  const map = new Map<string, Product[]>();
  if (videoIds.length === 0) return map;

  const { data, error } = await supabase
    .from('video_products')
    .select(
      `id, video_id, sort_order, catalog_product_id, name, price, image, provider,
       catalog_products (
         id, name, brand, price, image_url, merchant,
         verification_status, description, availability, last_verified_at, currency, metadata
       )`,
    )
    .in('video_id', videoIds)
    .order('sort_order', { ascending: true });

  if (error || !data) {
    if (error) console.error('video_products catalog join error:', error.code, error.message);
    return map;
  }

  for (const row of data as VideoProductRow[]) {
    const list = map.get(row.video_id) ?? [];
    list.push(mapRowToProduct(row));
    map.set(row.video_id, list);
  }
  return map;
}

export async function fetchVideos(): Promise<Video[]> {
  const { data, error } = await supabase.from('videos').select('*').order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase videos select error:', error.code, error.message);
    throw new Error(error.message || 'Could not load videos from Supabase');
  }

  const rows = (data ?? []) as DatabaseVideo[];
  const productMap = await fetchProductsForVideos(rows.map((v) => v.id));
  return rows.map((video) => mapVideoRow(video, productMap.get(video.id) ?? []));
}

export async function fetchVideoById(id: string): Promise<Video | null> {
  try {
    const { data, error } = await supabase.from('videos').select('*').eq('id', id).maybeSingle();

    if (error || !data) {
      return null;
    }

    const video = data as DatabaseVideo;
    const productMap = await fetchProductsForVideos([video.id]);
    return mapVideoRow(video, productMap.get(video.id) ?? []);
  } catch (error) {
    console.error('Error fetching video:', error);
    return null;
  }
}

export async function insertVideo(video: Omit<DatabaseVideo, 'id' | 'created_at' | 'updated_at'>): Promise<DatabaseVideo | null> {
  try {
    const { data, error } = await supabase.from('videos').insert([video]).select().single();
    if (error) {
      console.error('Error inserting video:', error);
      return null;
    }
    return data as DatabaseVideo;
  } catch (error) {
    console.error('Error inserting video:', error);
    return null;
  }
}

export async function updateVideo(id: string, updates: Partial<DatabaseVideo>): Promise<DatabaseVideo | null> {
  try {
    const { data, error } = await supabase.from('videos').update(updates).eq('id', id).select().single();
    if (error) {
      console.error('Error updating video:', error);
      return null;
    }
    return data as DatabaseVideo;
  } catch (error) {
    console.error('Error updating video:', error);
    return null;
  }
}

export async function deleteVideo(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('videos').delete().eq('id', id);
    if (error) {
      console.error('Error deleting video:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error deleting video:', error);
    return false;
  }
}

/** Batch catalog read for Collection product hydration (Catalog SoT). */
export async function fetchCatalogProductsByIds(
  ids: string[],
): Promise<Map<string, CatalogProductRow>> {
  const map = new Map<string, CatalogProductRow>();
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return map;

  const { data, error } = await supabase
    .from('catalog_products')
    .select(
      'id, name, brand, price, image_url, merchant, verification_status, description, availability, last_verified_at, currency, metadata',
    )
    .in('id', unique);

  if (error || !data) {
    if (error) console.error('catalog_products batch error:', error.code, error.message);
    return map;
  }

  for (const row of data) {
    const id = String((row as CatalogProductRow).id);
    map.set(id, row as CatalogProductRow);
  }
  return map;
}
