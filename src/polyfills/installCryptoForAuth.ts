/**
 * Supabase Auth PKCE uses `crypto.subtle.digest('SHA-256', …)` (see @supabase/auth-js).
 * React Native / Hermes often has no `crypto.subtle`, which triggers a console.warn and
 * falls back to PKCE `plain`. This shim uses `expo-crypto` so S256 is used like on web.
 */
import * as ExpoCrypto from 'expo-crypto';

function install() {
  const g = globalThis as typeof globalThis & { crypto?: Crypto };

  if (!g.crypto) {
    (g as { crypto: Crypto }).crypto = {} as Crypto;
  }

  const c = g.crypto as Crypto & { subtle?: SubtleCrypto };

  if (typeof c.getRandomValues !== 'function') {
    (c as { getRandomValues: (a: ArrayBufferView) => ArrayBufferView }).getRandomValues = (typedArray) => {
      ExpoCrypto.getRandomValues(typedArray as Parameters<typeof ExpoCrypto.getRandomValues>[0]);
      return typedArray;
    };
  }

  const subtleDigest = c.subtle?.digest;
  if (typeof subtleDigest === 'function') {
    return;
  }

  (c as { subtle: SubtleCrypto }).subtle = {
    ...c.subtle,
    digest: async (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
      const name = typeof algorithm === 'string' ? algorithm : (algorithm as { name: string }).name;
      if (name !== 'SHA-256') {
        throw new Error(`installCryptoForAuth: unsupported digest ${String(name)}`);
      }
      const buf =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, buf);
    },
  } as SubtleCrypto;
}

install();
