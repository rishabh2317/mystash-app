-- Async extraction queue, idempotent cache, and Gemini 429 backoff state.
-- Edge Functions use service_role (bypasses RLS); no client policies needed.

CREATE TABLE IF NOT EXISTS public.extraction_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_request_id uuid NOT NULL REFERENCES public.ingest_requests (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 8,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS extraction_jobs_pending_idx
  ON public.extraction_jobs (status, next_run_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS extraction_jobs_ingest_idx
  ON public.extraction_jobs (ingest_request_id);

CREATE TABLE IF NOT EXISTS public.extraction_cache (
  content_hash text PRIMARY KEY,
  platform text NOT NULL,
  external_video_key text,
  transcript_hash text NOT NULL,
  pipeline_version text NOT NULL,
  payload jsonb NOT NULL,
  hit_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS extraction_cache_lookup_idx
  ON public.extraction_cache (platform, external_video_key);

CREATE TABLE IF NOT EXISTS public.gemini_rate_state (
  id int PRIMARY KEY CHECK (id = 1),
  next_allowed_at timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  consecutive_429 int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.gemini_rate_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.extraction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gemini_rate_state ENABLE ROW LEVEL SECURITY;

-- Claim pending jobs (SKIP LOCKED). Increments attempts when moving to processing.
CREATE OR REPLACE FUNCTION public.claim_extraction_jobs(p_worker text, p_limit int)
RETURNS SETOF public.extraction_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.extraction_jobs j
  SET
    status = 'processing',
    locked_at = now(),
    locked_by = p_worker,
    attempts = j.attempts + 1,
    updated_at = now()
  WHERE j.id IN (
    SELECT ej.id
    FROM public.extraction_jobs ej
    WHERE ej.status = 'pending'
      AND ej.next_run_at <= now()
      AND ej.attempts < ej.max_attempts
    ORDER BY ej.next_run_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(p_limit, 1)
  )
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_extraction_jobs(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_extraction_jobs(text, int) TO service_role;
