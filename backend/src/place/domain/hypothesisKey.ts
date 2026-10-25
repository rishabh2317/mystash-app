/**
 * Stable identity of an extracted mention on one content source.
 * Location fields count only when present. A provider place id is never part of the key.
 */

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function placeHypothesisKey(input: {
  extractedName: string;
  locality?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  mentionedAddress?: string | null;
}): string {
  return [
    input.extractedName,
    input.locality,
    input.city,
    input.region,
    input.country,
    input.mentionedAddress,
  ]
    .map(norm)
    .join('\u001f');
}
