import '@/src/polyfills/installCryptoForAuth';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Product, Video } from '@/src/mocks/videos';
import { createClient } from '@supabase/supabase-js';

// Environment variables from .env file
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
  created_at?: string;
  updated_at?: string;
}

export interface DatabaseVideoProduct {
  id: string;
  video_id: string;
  name: string;
  price: string;
  image: string;
  affiliate_url: string | null;
  provider: string | null;
  sort_order: number;
}

function mapRowToProduct(row: DatabaseVideoProduct): Product {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    image: row.image || 'https://picsum.photos/seed/product/200/200',
    affiliate_url: row.affiliate_url ?? undefined,
    provider: row.provider ?? undefined,
  };
}

function mapVideoRow(video: DatabaseVideo, products: Product[]): Video {
  return {
    id: video.id,
    url: video.url,
    thumbnail: video.thumbnail,
    creator_name: video.creator_name,
    stash_score: video.stash_score,
    product_name: video.product_name,
    embed_url: video.embed_url,
    video_title: video.video_title,
    curator_id: video.curator_id,
    products: products.length > 0 ? products : undefined,
  };
}

async function fetchProductsForVideos(videoIds: string[]): Promise<Map<string, Product[]>> {
  const map = new Map<string, Product[]>();
  if (videoIds.length === 0) return map;

  const { data, error } = await supabase
    .from('video_products')
    .select('id, video_id, name, price, image, affiliate_url, provider, sort_order')
    .in('video_id', videoIds)
    .order('sort_order', { ascending: true });

  if (error || !data) {
    return map;
  }

  for (const row of data as DatabaseVideoProduct[]) {
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
    const { data, error } = await supabase
      .from('videos')
      .insert([video])
      .select()
      .single();

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
    const { data, error } = await supabase
      .from('videos')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

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
    const { error } = await supabase
      .from('videos')
      .delete()
      .eq('id', id);

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
