/** Share one in-flight request for a draft across mounted Create surfaces.
 * Rejections/failed responses are not cached, so retry uses the same draft ID. */
export function createPublishSingleFlight<T>() {
  const pending = new Map<string, { work: Promise<T>; signature: string }>();
  return (id: string, task: () => Promise<T>, signature = id): Promise<T> => {
    const existing = pending.get(id);
    if (existing) return existing.signature === signature ? existing.work
      : Promise.reject(new Error('This draft is already being published with another selection. Wait before retrying.'));
    const work = Promise.resolve().then(task).finally(() => { pending.delete(id); });
    pending.set(id, { work, signature });
    return work;
  };
}

export type PublishConfirmation = { ok: boolean; error?: string; collectionId?: string; videoId?: string };

/** Legacy acknowledgements without IDs need an owner-scoped status read. */
export async function confirmPublication(result: PublishConfirmation, read: () => Promise<{
  status: string; collection_id?: string | null; video_id?: string | null;
} | null>): Promise<PublishConfirmation> {
  if (!result.ok || result.collectionId || result.videoId) return result;
  const row = await read();
  if (row?.status !== 'published') return { ok: false, error: 'Publication was not confirmed. Reopen this draft and try again.' };
  return { ok: true, collectionId: row.collection_id ?? undefined, videoId: row.video_id ?? undefined };
}
