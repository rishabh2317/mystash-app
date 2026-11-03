/** Prevent a late read (including A -> B -> A) from replacing the current account snapshot. */
export function createOwnerReadFence() {
  let owner: string | null = null, epoch = 0, read = 0;
  return {
    configure(next: string | null) { if (next !== owner) { owner = next; epoch++; read++; } },
    begin() { return { owner,epoch,read: ++read }; },
    accepts(token: { owner: string | null; epoch: number; read: number }) { return owner === token.owner && epoch === token.epoch && read === token.read; },
    isOwner(value: string | null) { return owner === value; },
    invalidate() { read++; },
  };
}
