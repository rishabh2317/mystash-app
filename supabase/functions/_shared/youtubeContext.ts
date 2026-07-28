/**
 * Stage 1 — Context Gatherer ("Researcher")
 * Fetches title (oEmbed), optional description hint, and transcript when captions exist.
 */

import { ingestLog } from './ingestLog.ts';

export type YoutubeContextPack = {
  videoId: string;
  title: string;
  authorName: string;
  description: string;
  transcript: string;
  thumbnailUrl: string | null;
  /** Which subsystems contributed non-empty fields. */
  sources: string[];
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function appendSource(sources: string[], name: string) {
  if (!sources.includes(name)) sources.push(name);
}

async function fetchOEmbed(videoId: string): Promise<{ title: string; author_name: string; thumbnail_url: string } | null> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  try {
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
    const res = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const text = await res.text();
    const parsed = parseJson3Captions(text);
    if (parsed.length > 40) return parsed;
  }
  return '';
}

type CaptionTrack = { baseUrl?: string; languageCode?: string; kind?: string };

function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const human = tracks.find((t) => t.kind !== 'asr' && t.baseUrl);
  if (human?.baseUrl) return human;
  const asr = tracks.find((t) => t.baseUrl);
  return asr ?? null;
}

async function fetchTranscriptViaPlayer(videoId: string): Promise<string> {
  const body = {
    context: {
      client: {
        hl: 'en',
        gl: 'US',
        clientName: 'WEB',
        clientVersion: '2.20241126.01.00',
      },
    },
    videoId,
  };
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20241126.01.00',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return '';
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return '';
  }
  const root = json as {
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
  };
  const tracks = root.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track = pickCaptionTrack(tracks);
  if (!track?.baseUrl) return '';
  const capUrl = track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`;
  const capRes = await fetch(capUrl, { headers: { 'User-Agent': UA } });
  if (!capRes.ok) return '';
  const raw = await capRes.text();
  return parseJson3Captions(raw);
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

  ingestLog('info', 'pipeline.s1.youtube.start', { ...logCtx, videoId });

  const o = await fetchOEmbed(videoId);
  if (o) {
    title = o.title ?? '';
    authorName = o.author_name ?? '';
    thumbnailUrl = o.thumbnail_url ?? null;
    appendSource(sources, 'oembed');
  }

  let transcript = await fetchTimedtextDirect(videoId);
  if (transcript.length > 40) {
    appendSource(sources, 'timedtext_direct');
  } else {
    transcript = await fetchTranscriptViaPlayer(videoId);
    if (transcript.length > 40) appendSource(sources, 'innertube_captions');
  }

  if (!title) title = `YouTube video ${videoId}`;

  ingestLog('info', 'pipeline.s1.youtube.done', {
    ...logCtx,
    videoId,
    titleLen: title.length,
    transcriptLen: transcript.length,
    sources: sources.join(','),
  });

  return {
    videoId,
    title,
    authorName,
    description,
    transcript,
    thumbnailUrl,
    sources,
  };
}
