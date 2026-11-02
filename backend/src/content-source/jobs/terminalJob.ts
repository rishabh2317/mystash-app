export type TerminalJob = { getState(): Promise<string>; remove(): Promise<void> };
/** BullMQ's add operation returns duplicate IDs, so retirement must precede add. */
export async function retireTerminalJob(getJob: () => Promise<TerminalJob | undefined | null>): Promise<void> {
  const previous = await getJob();
  if (!previous || !['completed','failed'].includes(await previous.getState())) return;
  try { await previous.remove(); } catch {
    const current = await getJob();
    if (current && ['completed','failed'].includes(await current.getState())) throw new Error('content_source.retry_terminal_job_retained');
    // A competing retry already replaced it; do not remove live work.
  }
}
