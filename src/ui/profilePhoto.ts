/** Canonical avatar object size uploaded from device. */
export const PROFILE_AVATAR_PX = 384;

export const PROFILE_PHOTOS_BUCKET = 'profile-photos';

export const PROFILE_AVATAR_JPEG_QUALITY = 0.82;

export function squareCropOrigin(
  width: number,
  height: number,
): { originX: number; originY: number; width: number; height: number } {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const size = Math.min(w, h);
  return {
    originX: Math.floor((w - size) / 2),
    originY: Math.floor((h - size) / 2),
    width: size,
    height: size,
  };
}

/** Cache-friendly, user-scoped, versioned object path. */
export function versionedAvatarObjectPath(userId: string, versionMs: number, ext = 'jpg'): string {
  const id = userId.trim();
  const v = Number.isFinite(versionMs) ? Math.floor(versionMs) : Date.now();
  return `${id}/avatar-${v}.${ext}`;
}
