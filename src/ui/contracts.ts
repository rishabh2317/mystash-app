/**
 * Canonical control / surface state contracts (UX-B.1).
 * Parents own API/auth orchestration. Controls own local visual phase
 * (pressed, pending spinner, transient success) unless noted.
 *
 * User-facing commerce copy is Stash. Cart remains the internal/API name.
 */

export type ControlPhase =
  | 'default'
  | 'pressed'
  | 'pending'
  | 'success'
  | 'disabled'
  | 'error';

export type ControlKind =
  | 'save'
  | 'follow'
  | 'share'
  | 'addToBag'
  | 'buy'
  | 'bag'
  | 'productDetailsSheet'
  | 'toast';

export type StatusKind = 'loading' | 'empty' | 'error' | 'success';

export type ControlFlags = {
  disabled?: boolean;
  pending?: boolean;
  error?: boolean;
  success?: boolean;
  pressed?: boolean;
};

/**
 * Resolve visual phase. Priority:
 * disabled → pending → error → success → pressed → default
 */
export function resolveControlPhase(flags: ControlFlags): ControlPhase {
  if (flags.disabled) return 'disabled';
  if (flags.pending) return 'pending';
  if (flags.error) return 'error';
  if (flags.success) return 'success';
  if (flags.pressed) return 'pressed';
  return 'default';
}

export const CONTROL_OWNERSHIP: Record<ControlKind, string> = {
  save: 'Parent owns auth + Engagement save. Control is emit-only; pending/success (saved) are props.',
  follow: 'Parent owns auth + Engagement follow. Control is emit-only; pending/following are props.',
  share: 'Parent owns Share.share / shareLinks. Control is emit-only; optional disabled.',
  addToBag:
    'Parent owns auth + Cart API (internal). Control owns local pending → success visual. Outcome added | login | unavailable.',
  buy: 'Parent owns shopping redirect / Bag purchase-confirm. Control is emit-only; optional pending.',
  bag: 'Stash tab chrome. Count/badge on bottom-nav Stash icon from CartContext. Unsigned: no badge.',
  productDetailsSheet:
    'Parent owns product, buy, add-to-bag handlers. Sheet owns gallery/expand UI; does not call cart or shopping APIs.',
  toast: 'App-level feedback bus. Screens should prefer toast/inline over Alert except destructive confirms.',
};

export const BAG_COPY = {
  noun: 'Stash',
  yourStash: 'My Stash',
  add: 'Stash it',
  adding: 'Stashing…',
  added: 'Stashed',
  view: 'View Stash',
  empty: 'Your Stash is empty',
  emptyHint: "See something you love?\nStash it here and we'll remember it for you.",
  continueDiscovering: 'Continue discovering',
  signInTitle: 'Sign in to view your Stash',
  signInBody: 'Sign in to stash products you discover.',
  loadError: "Couldn’t load your Stash",
  addError: "Couldn’t stash that",
  removeError: "Couldn’t remove from Stash",
  updateError: "Couldn’t update your Stash",
  keepInBag: 'Keep in Stash?',
  keepInBagAction: 'Keep in Stash',
  removeFromBag: 'Remove from Stash',
  /** Opens merchant / product destination (not an in-app purchase). */
  buy: 'View Product',
} as const;

/** Rewrite leaked internal “cart” wording for UI. Does not change API names. */
export function displayBagError(raw: string | null | undefined, fallback: string): string {
  const t = raw?.trim();
  if (!t) return fallback;
  return t.replace(/cart/gi, BAG_COPY.noun);
}

export type ToastTone = 'info' | 'success' | 'error';

export type ToastSpec = {
  tone: ToastTone;
  title: string;
  /** Default 2800ms. */
  ttlMs?: number;
};

export const TOAST_DEFAULT_TTL_MS = 2800;

export const STATUS_OWNERSHIP: Record<StatusKind, string> = {
  loading: 'Full-screen or inline spinner/skeleton. Do not block chrome that already exists (back, bag).',
  empty: 'Honest empty copy + one action. Never disguise an error as empty.',
  error: 'Message + Retry. Prefer inline; Alert only if the user must acknowledge.',
  success: 'In-control or toast. Publish/add-to-bag should not require a blocking OK.',
};

export function controlOpacity(phase: ControlPhase, pressOpacity: number): number {
  if (phase === 'disabled' || phase === 'pending') return 0.7;
  if (phase === 'pressed') return pressOpacity;
  return 1;
}
