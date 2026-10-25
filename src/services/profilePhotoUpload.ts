import { File as ExpoFile } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/src/services/supabase';
import {
  PROFILE_AVATAR_JPEG_QUALITY,
  PROFILE_AVATAR_PX,
  PROFILE_PHOTOS_BUCKET,
  squareCropOrigin,
  versionedAvatarObjectPath,
} from '@/src/ui/profilePhoto';

export class ProfilePhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfilePhotoError';
  }
}

function photoLog(step: string, extra: Record<string, unknown> = {}): void {
  console.warn(`[profilePhoto] ${step}`, extra);
}

function publicSupabaseHost(): { defined: boolean; https: boolean; host: string | null } {
  const raw = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  if (!raw) return { defined: false, https: false, host: null };
  try {
    const u = new URL(raw);
    return { defined: true, https: u.protocol === 'https:', host: u.host };
  } catch {
    return { defined: true, https: false, host: null };
  }
}

function describeUnknownError(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    const extra = e as Error & { statusCode?: unknown; status?: unknown; code?: unknown };
    return {
      name: e.name,
      message: e.message,
      statusCode: extra.statusCode ?? extra.status ?? null,
      code: extra.code ?? null,
    };
  }
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    return {
      name: typeof o.name === 'string' ? o.name : 'object',
      message: typeof o.message === 'string' ? o.message : null,
      statusCode: o.statusCode ?? o.status ?? null,
      error: typeof o.error === 'string' ? o.error : null,
    };
  }
  return { name: typeof e, message: String(e) };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function pickAndNormalizeAvatar(): Promise<string | null> {
  photoLog('picker.permission.start');
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  photoLog('picker.permission.done', { granted: perm.granted, status: perm.status });
  if (!perm.granted) {
    throw new ProfilePhotoError('Photo library access is required to change your profile photo.');
  }

  photoLog('picker.launch');
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
    exif: false,
  });
  if (picked.canceled || !picked.assets[0]) {
    photoLog('picker.canceled');
    return null;
  }

  const asset = picked.assets[0];
  const width = asset.width || PROFILE_AVATAR_PX;
  const height = asset.height || PROFILE_AVATAR_PX;
  const crop = squareCropOrigin(width, height);
  photoLog('picker.asset', {
    uriScheme: asset.uri.split(':')[0] ?? null,
    width,
    height,
    crop,
  });

  photoLog('manipulator.start', { size: PROFILE_AVATAR_PX });
  const result = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ crop }, { resize: { width: PROFILE_AVATAR_PX, height: PROFILE_AVATAR_PX } }],
    {
      compress: PROFILE_AVATAR_JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );
  photoLog('manipulator.done', {
    uriScheme: result.uri.split(':')[0] ?? null,
    width: result.width,
    height: result.height,
  });
  return result.uri;
}

export async function uploadNormalizedAvatar(userId: string, localUri: string): Promise<string> {
  const id = userId.trim();
  if (!id) throw new ProfilePhotoError('Missing account id.');

  const cfg = publicSupabaseHost();
  const anonDefined = Boolean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim());
  photoLog('config', {
    supabaseUrlDefined: cfg.defined,
    supabaseHttps: cfg.https,
    supabaseHost: cfg.host,
    anonKeyDefined: anonDefined,
    bucket: PROFILE_PHOTOS_BUCKET,
  });

  const path = versionedAvatarObjectPath(id, Date.now(), 'jpg');
  photoLog('path', { hasUserId: Boolean(id), pathEndsJpg: path.endsWith('.jpg'), segments: path.split('/').length });

  const { data: sessionData } = await supabase.auth.getSession();
  photoLog('session', { hasAccessToken: Boolean(sessionData.session?.access_token) });
  if (!sessionData.session?.access_token) {
    throw new ProfilePhotoError('Not signed in.');
  }

  photoLog('bytes.start', { uriScheme: localUri.split(':')[0] ?? null });
  let body: ArrayBuffer;
  try {
    const file = new ExpoFile(localUri);
    const bytes = await file.bytes();
    photoLog('bytes.done', { byteLength: bytes.byteLength, exists: file.exists });
    if (!bytes.byteLength) {
      throw new ProfilePhotoError('Normalized photo was empty.');
    }
    body = toArrayBuffer(bytes);
  } catch (e) {
    photoLog('bytes.failed', describeUnknownError(e));
    throw e instanceof ProfilePhotoError
      ? e
      : new ProfilePhotoError('Could not read the normalized photo.');
  }

  photoLog('storage.upload.start', {
    bucket: PROFILE_PHOTOS_BUCKET,
    contentType: 'image/jpeg',
    byteLength: body.byteLength,
  });
  try {
    const { data, error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET).upload(path, body, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) {
      photoLog('storage.upload.error', describeUnknownError(error));
      throw new ProfilePhotoError(error.message || 'Storage upload failed.');
    }
    photoLog('storage.upload.ok', { hasPath: Boolean(data?.path) });
  } catch (e) {
    if (e instanceof ProfilePhotoError) throw e;
    photoLog('storage.upload.threw', describeUnknownError(e));
    const detail = e instanceof Error ? e.message : 'Storage upload failed.';
    throw new ProfilePhotoError(detail);
  }

  const { data: pub } = supabase.storage.from(PROFILE_PHOTOS_BUCKET).getPublicUrl(path);
  const url = pub.publicUrl?.trim();
  photoLog('publicUrl', { defined: Boolean(url), https: Boolean(url?.startsWith('https://')) });
  if (!url) throw new ProfilePhotoError('Could not resolve photo URL.');
  return url;
}
