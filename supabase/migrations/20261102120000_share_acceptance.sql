-- Local preparation. Deploy before enabling SHARE_ACCEPT_ENABLED.
BEGIN;
CREATE TABLE public.share_acceptance_receipts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capture_id uuid NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  import_id uuid NOT NULL REFERENCES public.user_imports(id) ON DELETE CASCADE,
  reply jsonb NOT NULL,
  dispatch_pending boolean NOT NULL DEFAULT true,
  dispatch_after timestamptz NOT NULL DEFAULT now(),
  dispatch_lease uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, capture_id)
);
CREATE INDEX share_receipts_dispatch_idx ON public.share_acceptance_receipts(dispatch_after);
ALTER TABLE public.share_acceptance_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.share_acceptance_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.share_acceptance_receipts TO service_role;

CREATE FUNCTION public.share_accept(p_user uuid, p_capture uuid, p_digest text, p_url text,
  p_dedupe text, p_platform text, p_external text, p_media_kind text, p_pipeline text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.share_acceptance_receipts; source_id uuid; import_id uuid; inserted integer; reply jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_capture::text,0));
  SELECT * INTO r FROM share_acceptance_receipts WHERE user_id=p_user AND capture_id=p_capture;
  IF FOUND THEN
    IF r.payload_digest <> p_digest THEN RAISE EXCEPTION 'capture_conflict'; END IF;
    RETURN r.reply || jsonb_build_object('replayed',true);
  END IF;
  INSERT INTO content_sources(platform,external_id,canonical_url,media_kind,processing_status,pipeline_version)
    VALUES(p_platform,p_external,p_url,p_media_kind,'RECEIVED',p_pipeline)
    ON CONFLICT(platform,external_id) DO NOTHING;
  SELECT id INTO STRICT source_id FROM content_sources WHERE platform=p_platform AND external_id=p_external;
  INSERT INTO user_imports(user_id,raw_input,source_url,normalized_url,dedupe_key,platform,status,content_source_id)
    VALUES(p_user,p_url,p_url,p_url,p_dedupe,p_platform,'RECEIVED',source_id)
    ON CONFLICT(user_id,dedupe_key) DO NOTHING RETURNING id INTO import_id;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  IF import_id IS NULL THEN
    SELECT id INTO STRICT import_id FROM user_imports WHERE user_id=p_user AND dedupe_key=p_dedupe FOR UPDATE;
    -- A new deliberate Save restores history; delivery replay above never does.
    UPDATE user_imports SET hidden_at=NULL WHERE id=import_id AND hidden_at IS NOT NULL;
  END IF;
  reply=jsonb_build_object('protocolVersion',2,'importId',import_id,'created',inserted=1,'replayed',false,'delivery','accepted');
  INSERT INTO share_acceptance_receipts(user_id,capture_id,payload_digest,import_id,reply)
    VALUES(p_user,p_capture,p_digest,import_id,reply);
  RETURN reply;
END $$;

CREATE FUNCTION public.share_claim_dispatch(p_lease uuid, p_limit integer DEFAULT 25)
RETURNS TABLE(user_id uuid,capture_id uuid,import_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH candidates AS (
    SELECT r.user_id,r.capture_id FROM share_acceptance_receipts r
    JOIN user_imports u ON u.id=r.import_id JOIN content_sources c ON c.id=u.content_source_id
    WHERE r.dispatch_after <= now() AND u.hidden_at IS NULL
      AND (r.dispatch_pending OR c.processing_status='QUEUED')
    ORDER BY r.dispatch_after,r.user_id,r.capture_id
    LIMIT greatest(1,least(p_limit,50)) FOR UPDATE OF r SKIP LOCKED
  )
  UPDATE share_acceptance_receipts r SET dispatch_lease=p_lease,dispatch_after=now()+interval '60 seconds'
  FROM candidates c WHERE r.user_id=c.user_id AND r.capture_id=c.capture_id
  RETURNING r.user_id,r.capture_id,r.import_id;
$$;
REVOKE ALL ON FUNCTION public.share_accept(uuid,uuid,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.share_claim_dispatch(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.share_accept(uuid,uuid,text,text,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.share_claim_dispatch(uuid,integer) TO service_role;
COMMIT;
