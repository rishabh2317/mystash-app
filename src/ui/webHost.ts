/** Display host for an external link (drops scheme and `www.`). */
export function hostLabel(url: string): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  const match = /^[a-z]+:\/\/([^/?#]+)/i.exec(raw);
  const host = match?.[1];
  if (!host) return null;
  return host.replace(/^www\./i, '').toLowerCase() || null;
}
