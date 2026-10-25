import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getEnv } from '../env';

const KEY_ID = 'v1';

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCryptoError';
  }
}

function parseKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new TokenCryptoError('CONNECTED_ACCOUNTS_ENCRYPTION_KEY is not configured');
  }
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  try {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    /* fall through */
  }
  // Derive a stable 32-byte key from longer secrets (dev/fallback).
  return createHash('sha256').update(trimmed, 'utf8').digest();
}

export function getEncryptionKeyId(): string {
  return KEY_ID;
}

export function encryptToken(plaintext: string, keyMaterial?: string): string {
  const key = parseKey(keyMaterial ?? getEnv('CONNECTED_ACCOUNTS_ENCRYPTION_KEY'));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptToken(packed: string, keyMaterial?: string): string {
  const key = parseKey(keyMaterial ?? getEnv('CONNECTED_ACCOUNTS_ENCRYPTION_KEY'));
  const parts = packed.split('.');
  if (parts.length !== 3) {
    throw new TokenCryptoError('Invalid ciphertext format');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64!, 'base64url');
  const tag = Buffer.from(tagB64!, 'base64url');
  const data = Buffer.from(dataB64!, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Never log plaintext or ciphertext. */
export function redactTokenForLog(_value: string | null | undefined): string {
  return '[redacted]';
}
