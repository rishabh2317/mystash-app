-- Phase 3: creator library membership over content_sources.
-- Metadata only. No media bytes. Instagram sync is not enabled by this migration.

ALTER TABLE public.content_sources
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

ALTER TABLE public.connected_accounts
  ADD COLUMN IF NOT EXISTS library_sync_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS library_sync_error text,
  ADD COLUMN IF NOT EXISTS last_library_sync_at timestamptz;

ALTER TABLE public.connected_accounts
  DROP CONSTRAINT IF EXISTS connected_accounts_library_sync_status_check;

ALTER TABLE public.connected_accounts
  ADD CONSTRAINT connected_accounts_library_sync_status_check
  CHECK (library_sync_status IN ('idle', 'running', 'failed'));

CREATE TABLE IF NOT EXISTS public.creator_library_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts (id) ON DELETE CASCADE,
  content_source_id uuid NOT NULL REFERENCES public.content_sources (id) ON DELETE RESTRICT,
  availability text NOT NULL DEFAULT 'available',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creator_library_memberships_availability_check
    CHECK (availability IN ('available', 'unavailable')),
  CONSTRAINT creator_library_memberships_account_source_unique
    UNIQUE (connected_account_id, content_source_id)
);

CREATE INDEX IF NOT EXISTS creator_library_memberships_user_seen_idx
  ON public.creator_library_memberships (user_id, last_seen_at DESC);

ALTER TABLE public.creator_library_memberships ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.creator_library_memberships IS
  'Creator-scoped membership of a global content_sources row. Unavailable does not delete the content identity.';
