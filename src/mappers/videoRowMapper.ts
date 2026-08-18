import type { Product, Video } from '@/src/mocks/videos';

export type VideoRowInput = {
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
};

export function mapVideoRow(video: VideoRowInput, products: Product[]): Video {
  return {
    id: video.id,
    url: video.url,
    thumbnail: video.thumbnail,
    creator_name: video.creator_name,
    stash_score: video.stash_score,
    product_name: products[0]?.name || video.product_name,
    embed_url: video.embed_url,
    video_title: video.video_title,
    curator_id: video.curator_id,
    collection_id: video.collection_id ?? null,
    products: products.length > 0 ? products : undefined,
  };
}
