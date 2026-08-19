/**
 * Instagram source adapter — metadata only.
 * Does not extract products. Downstream: existing reasoner + Product Intelligence + Collection.
 */

import { ingestLog } from './ingestLog';
import { extractInstagramPostId, parseSupportedVideoUrl } from './sourceIdentity';

export type InstagramAvailability = 'available' | 'unavailable' | 'restricted';

export type InstagramContextPack = {
  postId: string;
  canonicalUrl: string;
  title: string;
  authorName: string;
  description: string;
  thumbnailUrl: string | null;
  availability: InstagramAvailability;
  errorCode: string | null;
  errorMessage: string | null;
  sources: string[];
};

export type InstagramProbeResult =
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; stderr: string; code: number };

export type InstagramProbeFn = (sourceUrl: string) => Promise<InstagramProbeResult>;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function classifyInstagramProbeError(stderr: string): {
  availability: Exclude<InstagramAvailability, 'available'>;
  code: string;
  message: string;
} {
  const s = stderr.toLowerCase();
  if (
    /login required|please log in|cookies?|private account|not authorized|403|restricted|age.?restrict|join to (see|watch)|challenge_required/.test(
      s,
    )
  ) {
    return {
      availability: 'restricted',
      code: 'SOURCE_RESTRICTED',
      message:
        'This Instagram Reel is private, login-walled, or restricted. Use a public Reel, or add products manually.',
    };
  }
  if (
    /404|not found|removed|unavailable|does not exist|no video|empty media|unsupported url|unable to extract/.test(
      s,
    )
  ) {
    return {
      availability: 'unavailable',
      code: 'SOURCE_UNAVAILABLE',
      message: 'This Instagram content could not be found or is no longer available.',
    };
  }
  return {
    availability: 'unavailable',
    code: 'SOURCE_UNAVAILABLE',
    message: 'This Instagram content could not be loaded.',
  };
}

async function fetchOEmbed(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ title?: string; author_name?: string; thumbnail_url?: string } | null> {
  const endpoints = [
    `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}`,
    `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}`,
  ];
  for (const endpoint of endpoints) {
    try {
      const res = await fetchImpl(endpoint, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      return (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    } catch {
      /* try next */
    }
  }
  return null;
}

function stringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Gather Instagram caption/title/thumbnail without inventing products.
 * Probe is injectable (yt-dlp -j) so unit tests never shell out.
 */
export async function gatherInstagramContext(
  sourceUrl: string,
  opts?: {
    ingestId?: string;
    traceId?: string;
    fetchImpl?: typeof fetch;
    probe?: InstagramProbeFn;
  },
): Promise<InstagramContextPack> {
  const identity = parseSupportedVideoUrl(sourceUrl);
  const postId = identity?.externalId ?? extractInstagramPostId(sourceUrl) ?? '';
  const canonicalUrl = identity?.canonicalUrl ?? sourceUrl;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const sources: string[] = [];

  const empty = (availability: InstagramAvailability, code: string | null, message: string | null): InstagramContextPack => ({
    postId,
    canonicalUrl,
    title: '',
    authorName: '',
    description: '',
    thumbnailUrl: null,
    availability,
    errorCode: code,
    errorMessage: message,
    sources,
  });

  if (!postId) {
    return empty(
      'unavailable',
      'UNSUPPORTED_SOURCE',
      'Paste an Instagram Reel or post URL (instagram.com/reel/… or /p/…).',
    );
  }

  let title = '';
  let authorName = '';
  let description = '';
  let thumbnailUrl: string | null = null;

  const oembed = await fetchOEmbed(canonicalUrl, fetchImpl);
  if (oembed) {
    title = (oembed.title ?? '').trim();
    authorName = (oembed.author_name ?? '').trim();
    thumbnailUrl = oembed.thumbnail_url ?? null;
    if (title || authorName || thumbnailUrl) sources.push('oembed');
  }

  if (opts?.probe) {
    const probed = await opts.probe(canonicalUrl);
    if (probed.ok) {
      const json = probed.json;
      title = title || stringField(json, 'title') || stringField(json, 'fulltitle');
      authorName =
        authorName ||
        stringField(json, 'uploader') ||
        stringField(json, 'channel') ||
        stringField(json, 'creator');
      description = stringField(json, 'description');
      const thumb = stringField(json, 'thumbnail');
      if (thumb) thumbnailUrl = thumbnailUrl || thumb;
      sources.push('yt-dlp-json');
    } else if (sources.length === 0) {
      const classified = classifyInstagramProbeError(probed.stderr);
      ingestLog('warn', 'instagram.source_probe_failed', {
        ingestId: opts.ingestId,
        traceId: opts.traceId,
        postId,
        code: classified.code,
        message: probed.stderr.slice(0, 180),
      });
      return empty(classified.availability, classified.code, classified.message);
    }
  } else if (sources.length === 0) {
    ingestLog('warn', 'instagram.source_empty', {
      ingestId: opts?.ingestId,
      traceId: opts?.traceId,
      postId,
    });
    return empty(
      'unavailable',
      'SOURCE_UNAVAILABLE',
      'This Instagram Reel could not be loaded. It may be private or restricted.',
    );
  }

  ingestLog('info', 'instagram.context_ok', {
    ingestId: opts?.ingestId,
    postId,
    sources: sources.join(','),
    titleLen: title.length,
    descriptionLen: description.length,
  });

  return {
    postId,
    canonicalUrl,
    title: title || 'Instagram Reel',
    authorName,
    description,
    thumbnailUrl,
    availability: 'available',
    errorCode: null,
    errorMessage: null,
    sources,
  };
}
