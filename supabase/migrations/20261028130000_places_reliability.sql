-- Places milestone 2. Local preparation only. Requires milestone 1; do not deploy yet.
BEGIN;

ALTER TABLE public.content_source_import_progress
 ADD COLUMN evidence_complete boolean NOT NULL DEFAULT false,
 ADD COLUMN lease_active boolean NOT NULL DEFAULT false,
 ADD COLUMN lease_expires_at timestamptz;

-- One canonical user card can retain many source/hypothesis/import associations.
CREATE TABLE public.user_place_save_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 save_id uuid NOT NULL REFERENCES public.user_place_saves(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 content_source_place_id uuid NOT NULL REFERENCES public.content_source_places(id) ON DELETE CASCADE,
 content_source_id uuid NOT NULL REFERENCES public.content_sources(id) ON DELETE CASCADE,
 user_import_id uuid NOT NULL REFERENCES public.user_imports(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,content_source_place_id,user_import_id)
);
CREATE INDEX user_place_save_sources_save_idx ON public.user_place_save_sources(save_id);
CREATE INDEX user_place_save_sources_import_idx ON public.user_place_save_sources(user_import_id);
ALTER TABLE public.user_place_save_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_place_save_sources FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.user_place_save_sources TO service_role;
CREATE TABLE public.place_save_redirects (
 old_save_id uuid PRIMARY KEY,
 save_id uuid NOT NULL REFERENCES public.user_place_saves(id) ON DELETE CASCADE
);
ALTER TABLE public.place_save_redirects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.place_save_redirects FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.place_save_redirects TO service_role;

-- Exact known attribution only. Previously discarded links cannot be invented.
INSERT INTO public.user_place_save_sources(save_id,user_id,content_source_place_id,content_source_id,user_import_id,created_at)
 SELECT id,user_id,content_source_place_id,content_source_id,user_import_id,created_at FROM public.user_place_saves;

CREATE FUNCTION public.import_work_claim(p_source_id uuid,p_attempt_id uuid,p_version text,p_lease_seconds integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE previous public.content_source_import_progress; current_row public.content_source_import_progress; s public.content_sources;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('import-work:'||p_source_id::text,0));
 SELECT * INTO previous FROM public.content_source_import_progress WHERE content_source_id=p_source_id FOR UPDATE;
 IF previous.lease_active AND previous.lease_expires_at>clock_timestamp() THEN RETURN NULL; END IF;
 SELECT * INTO s FROM public.content_sources WHERE id=p_source_id FOR UPDATE;
 IF NOT FOUND OR s.processing_status NOT IN ('QUEUED','PROCESSING') THEN RETURN NULL; END IF;
 INSERT INTO public.content_source_import_progress(content_source_id,attempt_id,started_at,extraction_version,
  product_status,place_status,lease_active,lease_expires_at)
 VALUES(p_source_id,p_attempt_id,clock_timestamp(),p_version,'running','running',true,
  clock_timestamp()+make_interval(secs=>greatest(5,least(p_lease_seconds,120))))
 ON CONFLICT(content_source_id) DO UPDATE SET attempt_id=EXCLUDED.attempt_id,started_at=EXCLUDED.started_at,
  extraction_version=EXCLUDED.extraction_version,product_status='running',place_status='running',
  evidence_complete=false,lease_active=true,lease_expires_at=EXCLUDED.lease_expires_at RETURNING * INTO current_row;
 UPDATE public.content_sources SET processing_status='PROCESSING',failure_reason=NULL,updated_at=clock_timestamp() WHERE id=p_source_id;
 RETURN jsonb_build_object('progress',to_jsonb(current_row),'previous',CASE WHEN previous.content_source_id IS NULL THEN NULL ELSE to_jsonb(previous) END);
END $$;

CREATE FUNCTION public.import_work_renew(p_source_id uuid,p_attempt_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='10s' SET lock_timeout='2s' AS $$
BEGIN
 UPDATE public.content_source_import_progress SET lease_expires_at=clock_timestamp()+interval '60 seconds'
 WHERE content_source_id=p_source_id AND attempt_id=p_attempt_id AND lease_active AND lease_expires_at>clock_timestamp();
 RETURN FOUND;
END $$;
CREATE FUNCTION public.import_work_current(p_source_id uuid,p_attempt_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='10s' AS $$
 SELECT EXISTS(SELECT 1 FROM public.content_source_import_progress WHERE content_source_id=p_source_id
  AND attempt_id=p_attempt_id AND lease_active AND lease_expires_at>now())
$$;
CREATE FUNCTION public.import_work_release(p_source_id uuid,p_attempt_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='10s' SET lock_timeout='2s' AS $$
 UPDATE public.content_source_import_progress SET lease_active=false,lease_expires_at=clock_timestamp()
 WHERE content_source_id=p_source_id AND attempt_id=p_attempt_id
$$;

-- REST requests from a leased worker carry its source+attempt. A per-source row lock
-- fences every write transaction against lease takeover, not just status updates.
CREATE FUNCTION public.import_work_assert()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE headers jsonb; source_id uuid; attempt uuid; r public.content_source_import_progress;
BEGIN
 headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 IF NOT(headers ? 'x-mystash-import-source') AND NOT(headers ? 'x-mystash-import-attempt') THEN RETURN; END IF;
 source_id:=(headers->>'x-mystash-import-source')::uuid;
 attempt:=(headers->>'x-mystash-import-attempt')::uuid;
 SELECT * INTO r FROM public.content_source_import_progress WHERE content_source_id=source_id FOR UPDATE;
 IF NOT FOUND OR r.attempt_id IS DISTINCT FROM attempt OR NOT r.lease_active OR r.lease_expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'IMPORT_WORK_STALE' USING ERRCODE='55000'; END IF;
END $$;
CREATE FUNCTION public.import_work_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM public.import_work_assert(); RETURN NULL; END $$;

CREATE FUNCTION public.place_source_consistency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_place_saves s WHERE s.id=NEW.save_id AND s.user_id=NEW.user_id)
 OR NOT EXISTS(SELECT 1 FROM public.content_source_places h WHERE h.id=NEW.content_source_place_id AND h.content_source_id=NEW.content_source_id)
 OR NOT EXISTS(SELECT 1 FROM public.user_imports i WHERE i.id=NEW.user_import_id AND i.user_id=NEW.user_id AND i.content_source_id=NEW.content_source_id)
 THEN RAISE EXCEPTION 'Place source ownership mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER place_source_consistency BEFORE INSERT OR UPDATE ON public.user_place_save_sources
 FOR EACH ROW EXECUTE FUNCTION public.place_source_consistency();

CREATE FUNCTION public.place_upsert_hypothesis(p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE h public.content_source_places;
BEGIN
 PERFORM public.import_work_assert();
 INSERT INTO public.content_source_places(content_source_id,extracted_name,category,locality,city,region,country,
 mentioned_address,confidence,evidence,sources,resolution_state,unresolved_reason,hypothesis_key)
 VALUES((p_row->>'content_source_id')::uuid,p_row->>'extracted_name',p_row->>'category',p_row->>'locality',p_row->>'city',
 p_row->>'region',p_row->>'country',p_row->>'mentioned_address',(p_row->>'confidence')::numeric,
 coalesce(p_row->'evidence','{}'),coalesce(p_row->'sources','[]'),'unresolved',p_row->>'unresolved_reason',p_row->>'hypothesis_key')
 ON CONFLICT(content_source_id,hypothesis_key) DO UPDATE SET
 extracted_name=EXCLUDED.extracted_name,category=EXCLUDED.category,locality=EXCLUDED.locality,city=EXCLUDED.city,
 region=EXCLUDED.region,country=EXCLUDED.country,mentioned_address=EXCLUDED.mentioned_address,
 confidence=EXCLUDED.confidence,evidence=EXCLUDED.evidence,sources=EXCLUDED.sources,updated_at=clock_timestamp(),
 unresolved_reason=CASE WHEN content_source_places.resolution_state='resolved' THEN NULL ELSE EXCLUDED.unresolved_reason END
 RETURNING * INTO h;
 RETURN to_jsonb(h);
END $$;

-- Lock order: hypothesis -> canonical identity -> saves. All competing operations
-- use this order; provider calls never run inside the transaction.
CREATE FUNCTION public.place_mark_resolved(p_hypothesis_id uuid,p_place_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE h public.content_source_places; s public.user_place_saves; survivor public.user_place_saves;
BEGIN
 PERFORM public.import_work_assert();
 SELECT * INTO STRICT h FROM public.content_source_places WHERE id=p_hypothesis_id FOR UPDATE;
 PERFORM id FROM public.places WHERE id=p_place_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Canonical place not found' USING ERRCODE='23514'; END IF;
 IF h.place_id IS NOT NULL AND h.place_id<>p_place_id THEN
  RAISE EXCEPTION 'Hypothesis already has a different canonical identity' USING ERRCODE='23514'; END IF;
 UPDATE public.content_source_places SET place_id=p_place_id,resolution_state='resolved',unresolved_reason=NULL,
 updated_at=clock_timestamp() WHERE id=h.id RETURNING * INTO h;
 FOR s IN SELECT * FROM public.user_place_saves WHERE content_source_place_id=h.id ORDER BY user_id,id FOR UPDATE LOOP
  SELECT * INTO survivor FROM public.user_place_saves WHERE user_id=s.user_id AND place_id=p_place_id AND id<>s.id FOR UPDATE;
  IF FOUND THEN
   -- Move attribution before deleting the redundant card. Neither source disappears.
   UPDATE public.user_place_save_sources SET save_id=survivor.id WHERE save_id=s.id;
   UPDATE public.place_save_redirects SET save_id=survivor.id WHERE save_id=s.id;
   INSERT INTO public.place_save_redirects(old_save_id,save_id) VALUES(s.id,survivor.id)
    ON CONFLICT(old_save_id) DO UPDATE SET save_id=EXCLUDED.save_id;
   DELETE FROM public.user_place_saves WHERE id=s.id;
  ELSE
   UPDATE public.user_place_saves SET place_id=p_place_id,updated_at=clock_timestamp() WHERE id=s.id;
  END IF;
 END LOOP;
 RETURN to_jsonb(h);
END $$;

CREATE FUNCTION public.place_resolve_hypothesis(p_row jsonb,p_place jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE h jsonb; canonical uuid;
BEGIN
 PERFORM public.import_work_assert();
 h:=public.place_upsert_hypothesis(p_row);
 -- Lock the hypothesis before the canonical upsert for consistent lock ordering.
 PERFORM id FROM public.content_source_places WHERE id=(h->>'id')::uuid FOR UPDATE;
 INSERT INTO public.places(provider,provider_place_id,name,locality,city,region,country,category,formatted_address,latitude,longitude,maps_url)
 VALUES(p_place->>'provider',p_place->>'provider_place_id',p_place->>'name',p_place->>'locality',p_place->>'city',
 p_place->>'region',p_place->>'country',p_place->>'category',p_place->>'formatted_address',
 (p_place->>'latitude')::double precision,(p_place->>'longitude')::double precision,p_place->>'maps_url')
 ON CONFLICT(provider,provider_place_id) DO UPDATE SET provider_place_id=EXCLUDED.provider_place_id RETURNING id INTO canonical;
 RETURN public.place_mark_resolved((h->>'id')::uuid,canonical);
END $$;

CREATE FUNCTION public.place_attach_import(p_user_id uuid,p_hypothesis_id uuid,p_source_id uuid,p_import_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE h public.content_source_places; s public.user_place_saves;
BEGIN
 PERFORM public.import_work_assert();
 SELECT * INTO STRICT h FROM public.content_source_places WHERE id=p_hypothesis_id FOR UPDATE;
 IF h.content_source_id<>p_source_id OR NOT EXISTS(SELECT 1 FROM public.user_imports WHERE id=p_import_id
  AND user_id=p_user_id AND content_source_id=p_source_id) THEN
  RAISE EXCEPTION 'Import does not own this source' USING ERRCODE='23514'; END IF;
 IF h.place_id IS NOT NULL THEN
  PERFORM id FROM public.places WHERE id=h.place_id FOR UPDATE;
  SELECT * INTO s FROM public.user_place_saves WHERE user_id=p_user_id AND place_id=h.place_id FOR UPDATE;
 END IF;
 IF s.id IS NULL THEN
  SELECT * INTO s FROM public.user_place_saves WHERE user_id=p_user_id AND content_source_place_id=h.id FOR UPDATE;
 END IF;
 IF s.id IS NULL THEN
  INSERT INTO public.user_place_saves(user_id,content_source_place_id,place_id,content_source_id,user_import_id)
  VALUES(p_user_id,h.id,h.place_id,p_source_id,p_import_id) RETURNING * INTO s;
 END IF;
 INSERT INTO public.user_place_save_sources(save_id,user_id,content_source_place_id,content_source_id,user_import_id)
 VALUES(s.id,p_user_id,h.id,p_source_id,p_import_id)
 ON CONFLICT(user_id,content_source_place_id,user_import_id) DO UPDATE SET save_id=EXCLUDED.save_id;
 RETURN to_jsonb(s);
END $$;

CREATE FUNCTION public.place_upgrade_save(p_save_id uuid,p_place_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE before_row public.user_place_saves; after_row public.user_place_saves;
BEGIN
 PERFORM public.import_work_assert();
 SELECT * INTO before_row FROM public.user_place_saves WHERE id=p_save_id;
 IF NOT FOUND THEN
  SELECT s.* INTO STRICT before_row FROM public.place_save_redirects r JOIN public.user_place_saves s ON s.id=r.save_id WHERE r.old_save_id=p_save_id;
 END IF;
 PERFORM public.place_mark_resolved(before_row.content_source_place_id,p_place_id);
 SELECT * INTO STRICT after_row FROM public.user_place_saves WHERE user_id=before_row.user_id AND place_id=p_place_id;
 RETURN jsonb_build_object('save',to_jsonb(after_row),'merged',after_row.id<>p_save_id);
END $$;

-- Guard all persisted side effects reached by user-import work. Outside that
-- AsyncLocalStorage context, Creator/API/Analytics requests carry no work headers.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['content_sources','content_source_products','content_source_import_progress',
 'places','content_source_places','user_place_saves','user_place_save_sources','discovered_products',
 'cart_items','video_extraction_cache','product_match_history','catalog_search_candidates','catalog_products',
 'catalog_aliases','place_save_redirects','product_merchant_offers','canonical_products'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('CREATE TRIGGER import_work_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.import_work_write_guard()',t);
  END IF;
 END LOOP;
END $$;

DO $$ DECLARE p regprocedure; BEGIN
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (
 'import_work_claim','import_work_renew','import_work_current','import_work_release','import_work_assert','import_work_write_guard',
 'place_source_consistency','place_upsert_hypothesis','place_mark_resolved','place_resolve_hypothesis','place_attach_import','place_upgrade_save') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',p);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',p);
 END LOOP;
END $$;
COMMIT;
