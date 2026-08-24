/**
 * Stage 1 — Context Gatherer ("Researcher")
 * Fetches oEmbed metadata, Innertube description, and transcript when captions exist.
 */

import { ingestLog } from './ingestLog';

export type YoutubeContextPack = {
  videoId: string;
  title: string;
  authorName: string;
  description: string;
  descriptionSource: YoutubeDescriptionSource;
  transcript: string;
  thumbnailUrl: string | null;
  /** Which subsystems contributed non-empty fields. */
  sources: string[];
  playabilityStatus: string | null;
  /** Set when the source is private/unplayable and no public metadata was obtained. */
  sourceBlock?: {
    availability: 'restricted' | 'unavailable';
    code: string;
    message: string;
  };
};

/**
 * Fail closed only when YouTube says the video is not playable AND we have no public
 * oEmbed/player metadata. Public Shorts with empty captions still proceed.
 */
export function classifyYoutubePlayability(
  playabilityStatus: string | null,
  hasPublicMetadata: boolean,
): YoutubeContextPack['sourceBlock'] {
  if (hasPublicMetadata) return undefined;
  const s = (playabilityStatus ?? '').toUpperCase();
  if (s === 'LOGIN_REQUIRED' || s === 'AGE_CHECK_REQUIRED') {
    return {
      availability: 'restricted',
      code: 'SOURCE_RESTRICTED',
      message: 'This YouTube video is private, login-walled, or age-restricted.',
    };
  }
  if (s === 'UNPLAYABLE' || s === 'ERROR' || s === 'CONTENT_CHECK_REQUIRED') {
    return {
      availability: 'unavailable',
      code: 'SOURCE_UNAVAILABLE',
      message: 'This YouTube video could not be loaded or is no longer available.',
    };
  }
  return undefined;
}

export type YoutubeDescriptionSource =
  | 'innertube_video_details'
  | 'innertube_microformat'
  | 'innertube_structured'
  | 'empty_confirmed'
  | 'none';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Bound every YouTube HTTP call so UNPLAYABLE/dead videos cannot stall S1. */
export const YOUTUBE_REQUEST_TIMEOUT_MS = 4_000;

const TERMINAL_PLAYABILITY = new Set([
  'UNPLAYABLE',
  'ERROR',
  'LOGIN_REQUIRED',
  'CONTENT_CHECK_REQUIRED',
]);

export function isTerminalYoutubePlayability(status: string | null | undefined): boolean {
  return TERMINAL_PLAYABILITY.has((status ?? '').toUpperCase());
}

/**
 * After player+oEmbed, skip timedtext / next / caption fetches when YouTube
 * already said the video cannot be loaded and there are no caption tracks.
 */
export function shouldSkipYoutubeSecondaryFetches(input: {
  playabilityStatus: string | null;
  captionTrackCount: number;
}): boolean {
  return isTerminalYoutubePlayability(input.playabilityStatus) && input.captionTrackCount < 1;
}

async function youtubeRequest(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(YOUTUBE_REQUEST_TIMEOUT_MS),
  });
}

const INNERTUBE_CLIENT = {
  hl: 'en',
  gl: 'US',
  clientName: 'WEB',
  clientVersion: '2.20241126.01.00',
} as const;

function appendSource(sources: string[], name: string) {
  if (!sources.includes(name)) sources.push(name);
}

async function fetchOEmbed(videoId: string): Promise<{ title: string; author_name: string; thumbnail_url: string } | null> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
  try {
    const res = await youtubeRequest(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    return (await res.json()) as { title: string; author_name: string; thumbnail_url: string };
  } catch {
    return null;
  }
}

/** Parse json3 timedtext `events` into plain text (best-effort). */
function parseJson3Captions(raw: string): string {
  try {
    const j = JSON.parse(raw) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
    const parts: string[] = [];
    for (const ev of j.events ?? []) {
      for (const s of ev.segs ?? []) {
        const t = s.utf8?.trim();
        if (t) parts.push(t);
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

async function fetchTimedtextDirect(videoId: string): Promise<string> {
  const bases = [
    `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&fmt=json3&lang=en`,
    `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&fmt=json3&lang=en&kind=asr`,
    `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&fmt=json3&lang=en-US`,
  ];
  for (const u of bases) {
    try {
      const res = await youtubeRequest(u, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseJson3Captions(text);
      if (parsed.length > 40) return parsed;
    } catch {
      // Try the next timedtext variant, then Innertube captions.
    }
  }
  return '';
}

type CaptionTrack = { baseUrl?: string; languageCode?: string; kind?: string };
type InnertubeText = {
  simpleText?: string;
  runs?: Array<{ text?: string }>;
};
type InnertubePlayerContext = {
  title: string;
  authorName: string;
  thumbnailUrl: string | null;
  description: string;
  descriptionSource: YoutubeDescriptionSource;
  captionTracks: CaptionTrack[];
  playabilityStatus: string | null;
};

export type StructuredDescriptionResult = {
  description: string;
  emptyConfirmed: boolean;
};

function innertubeText(value: InnertubeText | undefined): string {
  if (typeof value?.simpleText === 'string') return value.simpleText.trim();
  return (value?.runs ?? [])
    .map((run) => run.text ?? '')
    .join('')
    .trim();
}

/** Pure parser kept separate so response-shape regressions can be tested without network access. */
export function parseInnertubePlayerContext(json: unknown): InnertubePlayerContext {
  const root = (json && typeof json === 'object' ? json : {}) as {
    playabilityStatus?: { status?: string };
    videoDetails?: {
      title?: string;
      author?: string;
      shortDescription?: string;
      thumbnail?: { thumbnails?: Array<{ url?: string; width?: number }> };
    };
    microformat?: {
      playerMicroformatRenderer?: {
        description?: InnertubeText;
      };
    };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
  };
  const videoDetailsDescription = root.videoDetails?.shortDescription?.trim() ?? '';
  const microformatDescription = innertubeText(
    root.microformat?.playerMicroformatRenderer?.description,
  );
  const thumbnails = root.videoDetails?.thumbnail?.thumbnails ?? [];
  const thumbnailUrl =
    [...thumbnails]
      .filter((thumbnail) => typeof thumbnail.url === 'string')
      .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;

  return {
    title: root.videoDetails?.title?.trim() ?? '',
    authorName: root.videoDetails?.author?.trim() ?? '',
    thumbnailUrl,
    description: videoDetailsDescription || microformatDescription,
    descriptionSource: videoDetailsDescription
      ? 'innertube_video_details'
      : microformatDescription
        ? 'innertube_microformat'
        : 'none',
    captionTracks:
      root.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [],
    playabilityStatus: root.playabilityStatus?.status?.trim() || null,
  };
}

/**
 * Modern YouTube often parks the full description in the watch "next" engagement panel
 * (`engagement-panel-structured-description`) rather than only in player `shortDescription`.
 */
export function parseStructuredDescriptionFromNext(json: unknown): StructuredDescriptionResult {
  const root = (json && typeof json === 'object' ? json : {}) as {
    engagementPanels?: Array<{
      engagementPanelSectionListRenderer?: {
        panelIdentifier?: string;
        targetId?: string;
        content?: {
          structuredDescriptionContentRenderer?: {
            items?: Array<Record<string, unknown>>;
          };
        };
      };
    }>;
  };

  for (const panel of root.engagementPanels ?? []) {
    const section = panel.engagementPanelSectionListRenderer;
    const id = section?.panelIdentifier ?? section?.targetId;
    if (id !== 'engagement-panel-structured-description') continue;

    for (const item of section?.content?.structuredDescriptionContentRenderer?.items ?? []) {
      const body = item.expandableVideoDescriptionBodyRenderer as
        | {
            descriptionPlaceholder?: { content?: string };
            attributedDescriptionBodyText?: { content?: string };
            colorSampledDescriptionBodyText?: { content?: string };
            descriptionBodyText?: InnertubeText;
          }
        | undefined;
      if (!body) continue;

      const placeholder = body.descriptionPlaceholder?.content?.trim() ?? '';
      const emptyConfirmed = /no description has been added/i.test(placeholder);

      const attributed = body.attributedDescriptionBodyText?.content?.trim() ?? '';
      const colorSampled = body.colorSampledDescriptionBodyText?.content?.trim() ?? '';
      const classic = innertubeText(body.descriptionBodyText);
      const description = attributed || colorSampled || classic;

      if (description || emptyConfirmed) {
        return { description, emptyConfirmed };
      }
    }
  }

  return { description: '', emptyConfirmed: false };
}

function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const human = tracks.find((t) => t.kind !== 'asr' && t.baseUrl);
  if (human?.baseUrl) return human;
  const asr = tracks.find((t) => t.baseUrl);
  return asr ?? null;
}

function innertubeHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'User-Agent': UA,
    'X-YouTube-Client-Name': '1',
    'X-YouTube-Client-Version': INNERTUBE_CLIENT.clientVersion,
  };
}

function innertubeBody(videoId: string) {
  return {
    context: { client: { ...INNERTUBE_CLIENT } },
    videoId,
  };
}

async function fetchInnertubePlayerContext(videoId: string): Promise<InnertubePlayerContext> {
  try {
    const res = await youtubeRequest('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: innertubeHeaders(),
      body: JSON.stringify(innertubeBody(videoId)),
    });
    if (!res.ok) return parseInnertubePlayerContext(null);
    return parseInnertubePlayerContext(await res.json());
  } catch {
    return parseInnertubePlayerContext(null);
  }
}

async function fetchInnertubeStructuredDescription(
  videoId: string,
): Promise<StructuredDescriptionResult> {
  try {
    const res = await youtubeRequest('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', {
      method: 'POST',
      headers: innertubeHeaders(),
      body: JSON.stringify(innertubeBody(videoId)),
    });
    if (!res.ok) return { description: '', emptyConfirmed: false };
    return parseStructuredDescriptionFromNext(await res.json());
  } catch {
    return { description: '', emptyConfirmed: false };
  }
}

async function fetchTranscriptFromTracks(tracks: CaptionTrack[]): Promise<string> {
  const track = pickCaptionTrack(tracks);
  if (!track?.baseUrl) return '';
  const capUrl = track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`;
  try {
    const capRes = await youtubeRequest(capUrl, { headers: { 'User-Agent': UA } });
    if (!capRes.ok) return '';
    const raw = await capRes.text();
    return parseJson3Captions(raw);
  } catch {
    return '';
  }
}

/**
 * Gather everything we can without yt-dlp: oEmbed metadata + captions (direct or via Innertube).
 */
export async function gatherYoutubeContext(
  videoId: string,
  logCtx: { ingestId: string; traceId: string },
): Promise<YoutubeContextPack> {
  const sources: string[] = [];
  let title = '';
  let authorName = '';
  let thumbnailUrl: string | null = null;
  let description = '';
  let descriptionSource: YoutubeDescriptionSource = 'none';

  ingestLog('info', 'pipeline.s1.youtube.start', { ...logCtx, videoId });

  const [o, player] = await Promise.all([
    fetchOEmbed(videoId),
    fetchInnertubePlayerContext(videoId),
  ]);
  if (o) {
    title = o.title ?? '';
    authorName = o.author_name ?? '';
    thumbnailUrl = o.thumbnail_url ?? null;
    appendSource(sources, 'oembed');
  }
  title ||= player.title;
  authorName ||= player.authorName;
  thumbnailUrl ??= player.thumbnailUrl;
  description = player.description;
  descriptionSource = player.descriptionSource;
  if (descriptionSource !== 'none') appendSource(sources, descriptionSource);

  const skipSecondary = shouldSkipYoutubeSecondaryFetches({
    playabilityStatus: player.playabilityStatus,
    captionTrackCount: player.captionTracks.length,
  });

  let emptyConfirmed = false;
  let transcript = '';
  if (skipSecondary) {
    ingestLog('info', 'pipeline.s1.youtube.fast_fail', {
      ...logCtx,
      videoId,
      playabilityStatus: player.playabilityStatus,
      reason: 'terminal_playability_without_captions',
    });
  } else {
    if (!description) {
      const structured = await fetchInnertubeStructuredDescription(videoId);
      emptyConfirmed = structured.emptyConfirmed;
      if (structured.description) {
        description = structured.description;
        descriptionSource = 'innertube_structured';
        appendSource(sources, descriptionSource);
      } else if (structured.emptyConfirmed) {
        descriptionSource = 'empty_confirmed';
        appendSource(sources, descriptionSource);
      }
    }

    transcript = await fetchTimedtextDirect(videoId);
    if (transcript.length > 40) {
      appendSource(sources, 'timedtext_direct');
    } else {
      transcript = await fetchTranscriptFromTracks(player.captionTracks);
      if (transcript.length > 40) appendSource(sources, 'innertube_captions');
    }
  }

  if (!title) title = `YouTube video ${videoId}`;

  ingestLog('info', 'pipeline.s1.youtube.done', {
    ...logCtx,
    videoId,
    titleLen: title.length,
    descriptionLength: description.length,
    descriptionSource,
    descriptionEmptyConfirmed: emptyConfirmed,
    playabilityStatus: player.playabilityStatus,
    transcriptLen: transcript.length,
    sources: sources.join(','),
  });

  const sourceBlock = classifyYoutubePlayability(
    player.playabilityStatus,
    Boolean(o) || Boolean(player.title),
  );

  return {
    videoId,
    title,
    authorName,
    description,
    descriptionSource,
    transcript,
    thumbnailUrl,
    sources,
    playabilityStatus: player.playabilityStatus,
    sourceBlock,
  };
}
