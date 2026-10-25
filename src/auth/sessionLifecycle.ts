/**
 * Official Supabase React Native pattern: refresh only while the app is active
 * so backgrounded clients do not spin on refresh failures.
 */

export type AuthRefreshControl = {
  startAutoRefresh: () => void;
  stopAutoRefresh: () => void;
};

export type AppStateLike = {
  currentState: string;
  addEventListener: (
    type: 'change',
    listener: (state: string) => void,
  ) => { remove: () => void };
};

let bound = false;
let subscription: { remove: () => void } | null = null;
let control: AuthRefreshControl | null = null;

function applyState(state: string): void {
  if (!control) return;
  if (state === 'active') control.startAutoRefresh();
  else control.stopAutoRefresh();
}

export function isAuthAutoRefreshBound(): boolean {
  return bound;
}

export function bindAuthAutoRefresh(
  auth: AuthRefreshControl,
  appState: AppStateLike | null | undefined,
): { alreadyBound: boolean } {
  if (!appState || typeof appState.addEventListener !== 'function') {
    return { alreadyBound: bound };
  }
  if (bound) return { alreadyBound: true };

  control = auth;
  bound = true;
  applyState(appState.currentState);
  subscription = appState.addEventListener('change', (next) => {
    applyState(next);
  });
  return { alreadyBound: false };
}

export function unbindAuthAutoRefresh(): void {
  subscription?.remove();
  subscription = null;
  control = null;
  bound = false;
}
