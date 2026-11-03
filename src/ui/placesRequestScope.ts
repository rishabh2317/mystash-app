/** Prevent stale Places requests from publishing after refresh, blur, or account change. */
export function createPlacesRequestScope() {
  let account: string | undefined;
  let generation = 0;
  return {
    setAccount(next: string | undefined) {
      if (account !== next) generation++;
      account = next;
    },
    begin() { return { account, generation: ++generation }; },
    isCurrent(ticket: { account: string | undefined; generation: number }) {
      return Boolean(account) && account === ticket.account && generation === ticket.generation;
    },
    invalidate() { generation++; },
  };
}
