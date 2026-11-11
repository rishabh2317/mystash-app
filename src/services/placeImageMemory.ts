import type { PlaceImageResource } from '../../backend/src/place/photos/contract';

export type PlaceImageSize = 128 | 256 | 640;
export type SessionPlaceImage = PlaceImageResource;
export type PhotoFailure = 'offline' | 'timeout' | 'expired' | 'rate_limit' | 'transient' | 'invalid';
export class PlaceImageError extends Error {
  constructor(readonly kind: PhotoFailure, readonly retryAfterMs = 0) { super(`place_image_${kind}`); }
}

/** Own bytes, rather than relying on a native image cache with an uncontrolled lifetime. */
export function imageDataUri(bytes: Uint8Array, mime: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += 12288) {
    let output = '';
    for (let i = start; i < Math.min(start + 12288, bytes.length); i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      output += alphabet[a >> 2] + alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)]
        + (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)] : '=')
        + (i + 2 < bytes.length ? alphabet[c & 63] : '=');
    }
    chunks.push(output);
  }
  return `data:${mime};base64,${chunks.join('')}`;
}

export function placeImageSize(logicalWidth: number, density: number, cap: PlaceImageSize = 640): PlaceImageSize {
  const pixels = Math.max(1, logicalWidth) * Math.max(1, density);
  return Math.min(cap, pixels <= 128 ? 128 : pixels <= 256 ? 256 : 640) as PlaceImageSize;
}

/** 300ms continuous demand; cancellation never starts work for a card already gone. */
export function schedulePlaceImage(work: () => void, delay = 300) {
  const timer = setTimeout(work, delay);
  return () => clearTimeout(timer);
}
