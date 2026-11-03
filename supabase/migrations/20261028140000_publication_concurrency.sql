-- Creator Publish only. Deploy before the matching API, with old publishers drained.
-- No existing data is rewritten. Each lease is private and scoped to one ingest.
BEGIN;

CREATE TABLE public.ingest_publication_leases (
 ingest_id uuid PRIMARY KEY REFERENCES public.ingest_requests(id) ON DELETE CASCADE,
 attempt_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,
 active boolean NOT NULL DEFAULT true
);
ALTER TABLE public.ingest_publication_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ingest_publication_leases FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ingest_publication_leases TO service_role;

CREATE FUNCTION public.publication_claim(p_ingest_id uuid,p_user_id uuid,p_attempt_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='10s' SET lock_timeout='2s' AS $$
DECLARE r public.ingest_publication_leases;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ingest_requests WHERE id=p_ingest_id AND user_id=p_user_id)
 THEN RAISE EXCEPTION 'Ingest not found' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.ingest_publication_leases(ingest_id,attempt_id,expires_at,active)
 VALUES(p_ingest_id,p_attempt_id,clock_timestamp()+interval '120 seconds',true)
 ON CONFLICT(ingest_id) DO NOTHING;
 SELECT * INTO STRICT r FROM public.ingest_publication_leases WHERE ingest_id=p_ingest_id FOR UPDATE;
 IF r.attempt_id=p_attempt_id AND r.active AND r.expires_at>clock_timestamp() THEN RETURN true; END IF;
 IF r.active AND r.expires_at>clock_timestamp() THEN RETURN false; END IF;
 UPDATE public.ingest_publication_leases SET attempt_id=p_attempt_id,active=true,
 expires_at=clock_timestamp()+interval '120 seconds' WHERE ingest_id=p_ingest_id;
 RETURN true;
END $$;

CREATE FUNCTION public.publication_renew(p_ingest_id uuid,p_attempt_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='10s' SET lock_timeout='2s' AS $$
BEGIN
 UPDATE public.ingest_publication_leases SET expires_at=clock_timestamp()+interval '120 seconds'
 WHERE ingest_id=p_ingest_id AND attempt_id=p_attempt_id AND active AND expires_at>clock_timestamp();
 RETURN FOUND;
END $$;

CREATE FUNCTION public.publication_release(p_ingest_id uuid,p_attempt_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='10s' SET lock_timeout='2s' AS $$
 UPDATE public.ingest_publication_leases SET active=false,expires_at=clock_timestamp()
 WHERE ingest_id=p_ingest_id AND attempt_id=p_attempt_id
$$;

-- Every publication write transaction locks the lease before its business rows.
-- Takeover/release cannot pass an in-flight mutation, even if its lease expires.
CREATE FUNCTION public.publication_assert()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE h jsonb; i uuid; a uuid; r public.ingest_publication_leases;
BEGIN
 h:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 IF NOT(h ? 'x-mystash-publish-ingest') AND NOT(h ? 'x-mystash-publish-attempt') THEN RETURN NULL; END IF;
 i:=(h->>'x-mystash-publish-ingest')::uuid; a:=(h->>'x-mystash-publish-attempt')::uuid;
 SELECT * INTO r FROM public.ingest_publication_leases WHERE ingest_id=i FOR UPDATE;
 IF NOT FOUND OR r.attempt_id IS DISTINCT FROM a OR NOT r.active OR r.expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'PUBLICATION_STALE' USING ERRCODE='55000'; END IF;
 RETURN i;
END $$;
CREATE FUNCTION public.publication_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM public.publication_assert(); RETURN NULL; END $$;

-- CollectionService's existing insert remains the source of creation fields.
-- The insert and its ingest link now commit or roll back as one transaction.
CREATE FUNCTION public.publication_link_collection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i uuid; draft public.ingest_requests;
BEGIN
 i:=public.publication_assert();
 IF i IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO STRICT draft FROM public.ingest_requests WHERE id=i FOR UPDATE;
 IF draft.user_id<>NEW.creator_id OR draft.status IN ('published','rejected','failed','processing')
 THEN RAISE EXCEPTION 'Draft cannot create a publication Collection' USING ERRCODE='23514'; END IF;
 IF TG_WHEN='BEFORE' THEN
  IF draft.collection_id IS NOT NULL THEN
   RAISE EXCEPTION 'Draft already owns a Collection; reload the same draft' USING ERRCODE='23514';
  END IF;
 ELSE
  UPDATE public.ingest_requests SET collection_id=NEW.id,updated_at=clock_timestamp() WHERE id=i;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER publication_collection_check BEFORE INSERT ON public.collections
 FOR EACH ROW EXECUTE FUNCTION public.publication_link_collection();
CREATE TRIGGER publication_collection_link AFTER INSERT ON public.collections
 FOR EACH ROW EXECUTE FUNCTION public.publication_link_collection();

-- Canonical identity may not be replaced by a late legacy link write. NULL is
-- still allowed for existing FK ON DELETE SET NULL behavior.
CREATE FUNCTION public.publication_ingest_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.collection_id IS NOT NULL AND NEW.collection_id IS NOT NULL AND OLD.collection_id<>NEW.collection_id
 THEN RAISE EXCEPTION 'Ingest Collection identity cannot be replaced' USING ERRCODE='23514'; END IF;
 IF NEW.status='published' AND OLD.status<>'published' AND NOT EXISTS(
  SELECT 1 FROM public.collections c JOIN public.videos v ON v.collection_id=c.id
  WHERE c.id=NEW.collection_id AND c.creator_id=NEW.user_id AND c.status='published' AND v.id=NEW.video_id
 ) THEN RAISE EXCEPTION 'Publication identity is incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER publication_ingest_identity BEFORE UPDATE ON public.ingest_requests
 FOR EACH ROW EXECUTE FUNCTION public.publication_ingest_identity();

-- Keep CollectionService validation/selection/search/eligibility semantics in TS.
-- Final projection replacement, ingest finalization and moderation fact are atomic.
CREATE FUNCTION public.publication_finalize(p_ingest_id uuid,p_collection_id uuid,p_video jsonb,p_products jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE i uuid; draft public.ingest_requests; c public.collections; v uuid; products jsonb;
BEGIN
 i:=public.publication_assert();
 IF i IS DISTINCT FROM p_ingest_id THEN RAISE EXCEPTION 'Publication scope required' USING ERRCODE='55000'; END IF;
 SELECT * INTO STRICT draft FROM public.ingest_requests WHERE id=i FOR UPDATE;
 IF draft.collection_id IS DISTINCT FROM p_collection_id THEN
  RAISE EXCEPTION 'Publication Collection mismatch' USING ERRCODE='23514'; END IF;
 IF draft.status='published' THEN
  RETURN jsonb_build_object('videoId',draft.video_id,'collectionId',draft.collection_id,'products','[]'::jsonb);
 END IF;
 IF draft.status IN ('rejected','failed','processing') THEN
  RAISE EXCEPTION 'Draft cannot be finalized' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT c FROM public.collections WHERE id=p_collection_id FOR UPDATE;
 IF c.creator_id<>draft.user_id OR c.status<>'published' OR c.deleted_at IS NOT NULL
 OR c.moderation_state IN ('takedown','rejected') THEN
  RAISE EXCEPTION 'Collection cannot be finalized' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(p_products) IS DISTINCT FROM 'array' OR jsonb_array_length(p_products)<1 THEN
  RAISE EXCEPTION 'Publication needs products' USING ERRCODE='23514'; END IF;
 v:=coalesce((p_video->>'id')::uuid,gen_random_uuid());
 IF v=p_collection_id THEN RAISE EXCEPTION 'Video and Collection IDs must be independent' USING ERRCODE='23514'; END IF;
 INSERT INTO public.videos(id,collection_id,url,thumbnail,creator_name,stash_score,product_name,embed_url,video_title,curator_id)
 VALUES(v,p_collection_id,p_video->>'url',p_video->>'thumbnail',p_video->>'creator_name',
 (p_video->>'stash_score')::numeric,p_video->>'product_name',p_video->>'embed_url',p_video->>'video_title',p_video->>'curator_id')
 ON CONFLICT(collection_id) DO UPDATE SET url=EXCLUDED.url,thumbnail=EXCLUDED.thumbnail,
 creator_name=EXCLUDED.creator_name,stash_score=EXCLUDED.stash_score,product_name=EXCLUDED.product_name,
 embed_url=EXCLUDED.embed_url,video_title=EXCLUDED.video_title,curator_id=EXCLUDED.curator_id
 RETURNING id INTO v;
 IF v=p_collection_id THEN RAISE EXCEPTION 'Video and Collection IDs must be independent' USING ERRCODE='23514'; END IF;
 DELETE FROM public.video_products WHERE video_id=v;
 WITH inserted AS (
  INSERT INTO public.video_products(video_id,name,price,image,merchant_url,affiliate_url,provider,sort_order,catalog_product_id,resolution_status)
  SELECT v,x.name,x.price,x.image,x.merchant_url,x.affiliate_url,x.provider,x.sort_order,x.catalog_product_id,x.resolution_status
  FROM jsonb_to_recordset(p_products) AS x(name text,price text,image text,merchant_url text,affiliate_url text,
   provider text,sort_order integer,catalog_product_id uuid,resolution_status text)
  RETURNING id,catalog_product_id,resolution_status,sort_order
 ) SELECT coalesce(jsonb_agg(to_jsonb(inserted) ORDER BY sort_order),'[]'::jsonb) INTO products FROM inserted;
 UPDATE public.ingest_requests SET status='published',video_id=v,collection_id=p_collection_id,
 updated_at=clock_timestamp() WHERE id=i;
 INSERT INTO public.moderation_actions(ingest_request_id,user_id,action,meta)
 VALUES(i,draft.user_id,'publish',jsonb_build_object('video_id',v,'collection_id',p_collection_id,'product_count',jsonb_array_length(p_products)));
 RETURN jsonb_build_object('videoId',v,'collectionId',p_collection_id,'products',products);
END $$;

-- Guards apply only when this API's scoped transport supplies publication headers.
-- Ordinary Creator ingestion, Places, Analytics and other writers retain behavior.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ingest_requests','ingest_draft_products','collections','collection_media',
 'collection_product_tags','videos','video_products','moderation_actions','users','user_settings','username_reservations',
 'catalog_products','catalog_aliases','product_merchant_offers','canonical_products','catalog_search_candidates',
 'product_match_history','cart_items'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('CREATE TRIGGER publication_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.publication_write_guard()',t);
  END IF;
 END LOOP;
END $$;
DO $$ DECLARE p regprocedure; BEGIN
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (
 'publication_claim','publication_renew','publication_release','publication_assert','publication_write_guard',
 'publication_link_collection','publication_ingest_identity','publication_finalize') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',p);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',p);
 END LOOP;
END $$;
COMMIT;
