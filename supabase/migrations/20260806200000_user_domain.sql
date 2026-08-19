-- User domain V1: public.users aligned 1:1 with auth.users.id
-- See backend/docs/USER_DOMAIN_SPEC.md

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  auth_provider text,
  username text NOT NULL,
  display_name text,
  profile_photo_url text,
  bio text,
  website_url text,
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb,

  account_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (account_status IN (
      'CREATED',
      'ACTIVE',
      'SUSPENDED',
      'DELETED',
      'ARCHIVED'
    )),
  creator_status text NOT NULL DEFAULT 'NONE'
    CHECK (creator_status IN (
      'NONE',
      'ONBOARDING',
      'ACTIVE',
      'SUSPENDED'
    )),
  account_type text NOT NULL DEFAULT 'personal'
    CHECK (account_type IN ('personal', 'business')),

  country text,
  language text,
  timezone text,

  joined_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  email_mirrored text,

  followers_count int NOT NULL DEFAULT 0,
  following_count int NOT NULL DEFAULT 0,
  collection_count int NOT NULL DEFAULT 0,
  counters_updated_at timestamptz,

  schema_version int NOT NULL DEFAULT 1,
  extensions jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uidx
  ON public.users (lower(username))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_account_status_idx ON public.users (account_status);
CREATE INDEX IF NOT EXISTS users_creator_status_idx ON public.users (creator_status);
CREATE INDEX IF NOT EXISTS users_deleted_at_idx ON public.users (deleted_at);

CREATE TABLE IF NOT EXISTS public.username_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  redirect_to_username text NOT NULL,
  reserved_until timestamptz NOT NULL,
  -- Immutable flag for partial unique index (Postgres forbids now() in index predicates).
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent if table was created by a failed earlier attempt without is_active.
ALTER TABLE public.username_reservations
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Only one active reservation per username. Expiry clears is_active in app (not via now() in index).
CREATE UNIQUE INDEX IF NOT EXISTS username_reservations_username_lower_uidx
  ON public.username_reservations (lower(username))
  WHERE is_active;

CREATE INDEX IF NOT EXISTS username_reservations_user_id_idx
  ON public.username_reservations (user_id);

CREATE INDEX IF NOT EXISTS username_reservations_reserved_until_idx
  ON public.username_reservations (reserved_until)
  WHERE is_active;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.username_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_public ON public.users;
CREATE POLICY users_select_public ON public.users
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND account_status IN ('CREATED', 'ACTIVE')
  );

DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own ON public.users
  FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS users_update_own ON public.users;
CREATE POLICY users_update_own ON public.users
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS users_insert_own ON public.users;
CREATE POLICY users_insert_own ON public.users
  FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS username_reservations_select_public ON public.username_reservations;
CREATE POLICY username_reservations_select_public ON public.username_reservations
  FOR SELECT
  USING (reserved_until > now());

COMMENT ON TABLE public.users IS 'Mystash User aggregate; id = auth.users.id';
COMMENT ON COLUMN public.users.creator_status IS 'NONE|ONBOARDING|ACTIVE|SUSPENDED; is_creator is computed';
COMMENT ON COLUMN public.users.account_status IS 'Login/use axis; orthogonal to creator_status';
