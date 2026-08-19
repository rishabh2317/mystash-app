-- Repair: username_reservations index cannot use now() (not IMMUTABLE).
-- Safe if 20260806200000 partially applied or already created the table without the bad index.

ALTER TABLE public.username_reservations
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Deactivate expired rows before enforcing uniqueness.
UPDATE public.username_reservations
SET is_active = false
WHERE is_active = true
  AND reserved_until <= now();

DROP INDEX IF EXISTS public.username_reservations_username_lower_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS username_reservations_username_lower_uidx
  ON public.username_reservations (lower(username))
  WHERE is_active;

CREATE INDEX IF NOT EXISTS username_reservations_reserved_until_idx
  ON public.username_reservations (reserved_until)
  WHERE is_active;
