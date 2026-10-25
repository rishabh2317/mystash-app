-- Phase 2: connected Instagram/YouTube accounts (linking only; no media sync).
-- Tokens live in connected_account_secrets (ciphertext); never in users.social_links.

CREATE TABLE IF NOT EXISTS public.connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  provider text NOT NULL,
  platform_account_id text NOT NULL,
  display_name text,
  username text,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  last_health_check_at timestamptz,
  last_health_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connected_accounts_provider_check
    CHECK (provider IN ('youtube', 'instagram')),
  CONSTRAINT connected_accounts_status_check
    CHECK (status IN ('active', 'needs_reauth', 'revoked', 'disconnected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS connected_accounts_user_provider_platform_uidx
  ON public.connected_accounts (user_id, provider, platform_account_id);

CREATE INDEX IF NOT EXISTS connected_accounts_user_provider_idx
  ON public.connected_accounts (user_id, provider);

CREATE TABLE IF NOT EXISTS public.connected_account_secrets (
  connected_account_id uuid PRIMARY KEY
    REFERENCES public.connected_accounts (id) ON DELETE CASCADE,
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  encryption_key_id text NOT NULL DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_account_secrets ENABLE ROW LEVEL SECURITY;

-- Service-role backend only; no direct client policies.
