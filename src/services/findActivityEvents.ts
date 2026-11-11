/** Ephemeral receipt notifications; never persisted or shared between accounts. */
export type FindReceipt = { owner: string; id: string; sourceUrl: string; created: boolean };
const listeners = new Set<(receipt: FindReceipt) => void>();
export function notifyFindReceived(receipt: FindReceipt) {
  listeners.forEach(listener => listener(receipt));
}
export function subscribeFindReceived(listener: (receipt: FindReceipt) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
