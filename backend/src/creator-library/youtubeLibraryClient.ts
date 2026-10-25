import {
  LIBRARY_SYNC_PAGE_SIZE,
  mapPlaylistItem,
  type YouTubeLibraryItem,
} from './youtubePlaylist';

export type YouTubeLibraryPage = {
  uploadsPlaylistId: string;
  items: YouTubeLibraryItem[];
  nextPageToken: string | null;
};

export async function fetchYouTubeUploadsPage(params: {
  accessToken: string;
  uploadsPlaylistId?: string | null;
  pageToken?: string | null;
}): Promise<YouTubeLibraryPage> {
  let playlistId = params.uploadsPlaylistId ?? null;
  if (!playlistId) {
    const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
    channelUrl.searchParams.set('part', 'contentDetails');
    channelUrl.searchParams.set('mine', 'true');
    const channelRes = await fetch(channelUrl, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    const channelJson = (await channelRes.json()) as {
      items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
      error?: { message?: string };
    };
    if (!channelRes.ok) {
      throw new Error(channelJson.error?.message || 'YouTube channels.list failed');
    }
    playlistId = channelJson.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
    if (!playlistId) throw new Error('No YouTube uploads playlist for this channel');
  }

  const listUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  listUrl.searchParams.set('part', 'snippet,contentDetails,status');
  listUrl.searchParams.set('playlistId', playlistId);
  listUrl.searchParams.set('maxResults', String(LIBRARY_SYNC_PAGE_SIZE));
  if (params.pageToken) listUrl.searchParams.set('pageToken', params.pageToken);
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  const listJson = (await listRes.json()) as {
    items?: Parameters<typeof mapPlaylistItem>[0][];
    nextPageToken?: string;
    error?: { message?: string };
  };
  if (!listRes.ok) {
    throw new Error(listJson.error?.message || 'YouTube playlistItems.list failed');
  }
  return {
    uploadsPlaylistId: playlistId,
    items: (listJson.items ?? []).map(mapPlaylistItem).filter((item): item is YouTubeLibraryItem => Boolean(item)),
    nextPageToken: listJson.nextPageToken ?? null,
  };
}
