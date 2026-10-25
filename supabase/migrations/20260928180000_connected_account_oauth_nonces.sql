-- Single-use OAuth state nonces for the backend YouTube callback.
-- The browser returns here without a Mystash session; the nonce stops replay.

CREATE TABLE IF NOT EXISTS public.connected_account_oauth_nonces (
  nonce text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  provider text NOT NULL,
  surface text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connected_account_oauth_nonces_provider_check
    CHECK (provider IN ('youtube', 'instagram')),
  CONSTRAINT connected_account_oauth_nonces_surface_check
    CHECK (surface IN ('native', 'web'))
);

CREATE INDEX IF NOT EXISTS connected_account_oauth_nonces_expires_idx
  ON public.connected_account_oauth_nonces (expires_at);

ALTER TABLE public.connected_account_oauth_nonces ENABLE ROW LEVEL SECURITY;
