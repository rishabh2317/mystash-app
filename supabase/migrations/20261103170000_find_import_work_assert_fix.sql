-- Qualify the local source identifier so non-image extraction writes do not fail
-- with PL/pgSQL's ambiguous source_id error after private image guards are installed.
CREATE OR REPLACE FUNCTION public.import_work_assert() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE headers jsonb; v_source_id uuid; attempt uuid; r public.content_source_import_progress;
BEGIN
 headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 IF NOT(headers ? 'x-mystash-import-source') AND NOT(headers ? 'x-mystash-import-attempt') THEN RETURN; END IF;
 v_source_id:=(headers->>'x-mystash-import-source')::uuid; attempt:=(headers->>'x-mystash-import-attempt')::uuid;
 SELECT * INTO r FROM content_source_import_progress WHERE content_source_id=v_source_id FOR UPDATE;
 IF NOT FOUND OR r.attempt_id IS DISTINCT FROM attempt OR NOT r.lease_active OR r.lease_expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'IMPORT_WORK_STALE' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM content_sources WHERE id=v_source_id AND media_kind='IMAGE') AND NOT EXISTS(
  SELECT 1 FROM find_image_assets a JOIN user_imports i ON i.id=a.import_id WHERE a.source_id=v_source_id AND a.state='accepted' AND i.hidden_at IS NULL)
 THEN RAISE EXCEPTION 'IMPORT_WORK_STALE' USING ERRCODE='55000'; END IF;
END $$;
