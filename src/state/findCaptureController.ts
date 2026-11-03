import { extractSharedLink, sharedLinkMessage } from '@/src/ui/shareImport';
export type FindCaptureState = { owner: string | null; input: string; busy: boolean; error: string | null; ack: { id: string; created: boolean } | null };
export function createFindCaptureController(submit: (text: string, owner: string) => Promise<{ importId: string; created: boolean }>) {
  let state: FindCaptureState = { owner: null,input: '',busy: false,error: null,ack: null }, active = false, epoch = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<FindCaptureState>) => { state = { ...state,...patch }; listeners.forEach(fn => fn()); };
  return {
    getState: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    configure(owner: string | null) { if (state.owner === owner) return; epoch++; publish({ owner,input: '',busy: false,error: null,ack: null }); },
    setActive(value: boolean) { if (active === value) return; active = value; epoch++; publish({ busy: false }); },
    setInput(input: string) { publish({ input,error: null,ack: null }); },
    clearAck() { publish({ ack: null,error: null }); },
    async submit() {
      if (!active || !state.owner || state.busy) return;
      const parsed = extractSharedLink(state.input);
      if (!parsed.ok) { publish({ error: sharedLinkMessage(parsed.reason) }); return; }
      const owner = state.owner, token = ++epoch; publish({ busy: true,error: null });
      try {
        const result = await submit(parsed.rawInput,owner);
        if (active && token === epoch && owner === state.owner) publish({ ack: { id: result.importId,created: result.created },input: '' });
      } catch (error) { if (active && token === epoch && owner === state.owner) publish({ error: error instanceof Error ? error.message : 'Couldn’t confirm receipt. Your text is still here; try again.' }); }
      finally { if (active && token === epoch && owner === state.owner) publish({ busy: false }); }
    },
  };
}
