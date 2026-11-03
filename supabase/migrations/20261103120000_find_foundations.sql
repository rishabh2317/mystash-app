-- Universal Find phase 1. Additive preparation only; enable matching API/workers later.
BEGIN;
ALTER TABLE public.cart_items ADD COLUMN removed_at timestamptz, ADD COLUMN explicit_action_at timestamptz;
ALTER TABLE public.user_place_saves ADD COLUMN removed_at timestamptz, ADD COLUMN explicit_action_at timestamptz;
ALTER TABLE public.content_source_places ADD COLUMN retired_at timestamptz;
ALTER TABLE public.content_source_import_progress ADD COLUMN finished_at timestamptz;
ALTER TABLE public.user_imports
 ADD COLUMN stash_sync_state text CHECK(stash_sync_state IN ('pending','complete','failed')),
 ADD COLUMN stash_sync_revision bigint NOT NULL DEFAULT 0,
 ADD COLUMN stash_sync_attempt_id uuid,
 ADD COLUMN stash_sync_after timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN stash_sync_lease uuid,
 ADD COLUMN stash_sync_until timestamptz;
CREATE INDEX find_sync_pending_idx ON public.user_imports(stash_sync_after,id)
 WHERE hidden_at IS NULL AND stash_sync_state IN ('pending','failed');

-- A system delivery marker, not review state. Historical imports are not backfilled.
CREATE FUNCTION public.find_mark_sync_pending() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source_id uuid;
BEGIN
 IF TG_TABLE_NAME='user_imports' THEN
  NEW.stash_sync_state:='pending'; NEW.stash_sync_revision:=coalesce(NEW.stash_sync_revision,0)+1;
  NEW.stash_sync_lease:=NULL; NEW.stash_sync_until:=NULL; NEW.stash_sync_after:=clock_timestamp();
  SELECT attempt_id INTO NEW.stash_sync_attempt_id FROM content_source_import_progress WHERE content_source_id=NEW.content_source_id;
  RETURN NEW;
 END IF;
 source_id:=NEW.content_source_id;
 UPDATE user_imports SET stash_sync_state='pending',stash_sync_revision=stash_sync_revision+1,
  stash_sync_attempt_id=(SELECT attempt_id FROM content_source_import_progress WHERE content_source_id=source_id),
  stash_sync_after=clock_timestamp(),stash_sync_lease=NULL,stash_sync_until=NULL
 WHERE content_source_id=source_id AND hidden_at IS NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER find_import_sync BEFORE INSERT OR UPDATE OF content_source_id,attempt_started_at,hidden_at ON public.user_imports
 FOR EACH ROW EXECUTE FUNCTION public.find_mark_sync_pending();
CREATE TRIGGER find_product_sync AFTER INSERT OR UPDATE ON public.content_source_products
 FOR EACH ROW EXECUTE FUNCTION public.find_mark_sync_pending();
CREATE TRIGGER find_place_sync AFTER INSERT OR UPDATE ON public.content_source_places
 FOR EACH ROW EXECUTE FUNCTION public.find_mark_sync_pending();
CREATE TRIGGER find_attempt_sync AFTER INSERT OR UPDATE OF attempt_id ON public.content_source_import_progress
 FOR EACH ROW EXECUTE FUNCTION public.find_mark_sync_pending();
CREATE FUNCTION public.find_finish_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 NEW.finished_at:=CASE WHEN NEW.product_status<>'running' AND NEW.place_status<>'running'
  THEN coalesce(CASE WHEN TG_OP='UPDATE' AND OLD.attempt_id=NEW.attempt_id THEN OLD.finished_at END,clock_timestamp()) ELSE NULL END;
 RETURN NEW;
END $$;
CREATE TRIGGER find_attempt_finished BEFORE INSERT OR UPDATE ON public.content_source_import_progress
 FOR EACH ROW EXECUTE FUNCTION public.find_finish_attempt();

CREATE FUNCTION public.find_claim_stash_sync(p_lease uuid,p_limit integer DEFAULT 25)
RETURNS SETOF public.user_imports LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH picked AS (
  SELECT i.id FROM user_imports i JOIN content_sources s ON s.id=i.content_source_id
  WHERE i.hidden_at IS NULL AND i.stash_sync_state IN ('pending','failed') AND i.stash_sync_after<=clock_timestamp()
   AND (i.stash_sync_until IS NULL OR i.stash_sync_until<clock_timestamp())
   AND s.processing_status IN ('READY','FAILED')
  ORDER BY i.stash_sync_after,i.id LIMIT greatest(1,least(p_limit,25)) FOR UPDATE OF i SKIP LOCKED
 ) UPDATE user_imports i SET stash_sync_lease=p_lease,stash_sync_until=clock_timestamp()+interval '2 minutes'
 FROM picked WHERE i.id=picked.id RETURNING i.*
$$;
CREATE FUNCTION public.find_finish_stash_sync(p_import uuid,p_lease uuid,p_revision bigint,p_success boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE user_imports SET stash_sync_state=CASE WHEN p_success THEN 'complete' ELSE 'failed' END,
 stash_sync_lease=NULL,stash_sync_until=NULL,stash_sync_after=clock_timestamp()+interval '30 seconds'
 WHERE id=p_import AND stash_sync_lease=p_lease AND stash_sync_revision=p_revision
  AND stash_sync_until>clock_timestamp() AND hidden_at IS NULL;
 RETURN FOUND;
END $$;

-- Follow only existing catalog merge links; never infer identity from names.
CREATE FUNCTION public.find_catalog_survivor(p_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH RECURSIVE chain AS (
  SELECT id,status,merged_into_id,ARRAY[id] AS path FROM catalog_products WHERE id=p_id
  UNION ALL SELECT p.id,p.status,p.merged_into_id,c.path||p.id FROM chain c
   JOIN catalog_products p ON p.id=c.merged_into_id
   WHERE c.status='MERGED' AND NOT(p.id=ANY(c.path)) AND cardinality(c.path)<16
 ) SELECT id FROM chain WHERE status<>'MERGED' ORDER BY cardinality(path) DESC LIMIT 1
$$;

-- Atomic user actions serialize with automatic materialization. Removed rows retain identity/provenance.
CREATE FUNCTION public.find_cart_put(p_user uuid,p_catalog uuid,p_discovered uuid,p_source jsonb,p_automatic boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.cart_items; existed boolean; stamp timestamptz; alias_row public.cart_items;
BEGIN
 PERFORM import_work_assert();
 IF (p_catalog IS NULL)=(p_discovered IS NULL) THEN RAISE EXCEPTION 'Invalid product identity' USING ERRCODE='23514'; END IF;
 IF p_catalog IS NOT NULL THEN
  PERFORM id FROM catalog_products WHERE id=p_catalog AND status='ACTIVE' FOR SHARE;
 ELSE
  PERFORM id FROM discovered_products WHERE id=p_discovered AND internal_status='ACTIVE' FOR SHARE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('find-cart:'||p_user::text,0));
 stamp:=clock_timestamp();
 IF p_automatic OR p_source->>'source_user_import_id' IS NOT NULL THEN
  PERFORM id FROM user_imports WHERE id=(p_source->>'source_user_import_id')::uuid
   AND user_id=p_user AND content_source_id=(p_source->>'source_content_source_id')::uuid AND hidden_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO r FROM cart_items WHERE user_id=p_user AND
  (catalog_product_id=p_catalog OR discovered_product_id=p_discovered) FOR UPDATE;
 existed:=FOUND;
 -- Known catalog/discovered aliases carry the latest explicit decision.
 SELECT c.* INTO alias_row FROM cart_items c LEFT JOIN discovered_products d ON d.id=c.discovered_product_id
 LEFT JOIN catalog_products k ON k.id=c.catalog_product_id
 WHERE c.user_id=p_user AND c.explicit_action_at IS NOT NULL AND (
  (p_catalog IS NOT NULL AND (d.catalog_product_id=p_catalog OR find_catalog_survivor(k.id)=p_catalog OR c.catalog_product_id=p_catalog))
  OR (p_discovered IS NOT NULL AND c.catalog_product_id=(SELECT catalog_product_id FROM discovered_products WHERE id=p_discovered)))
 ORDER BY c.explicit_action_at DESC,c.removed_at DESC NULLS LAST,c.id LIMIT 1;
 IF p_automatic AND alias_row.removed_at IS NOT NULL AND
  (r.explicit_action_at IS NULL OR alias_row.explicit_action_at>=r.explicit_action_at) THEN
  IF existed THEN UPDATE cart_items SET removed_at=alias_row.removed_at,explicit_action_at=alias_row.explicit_action_at WHERE id=r.id RETURNING * INTO r;
  ELSE r:=alias_row; END IF;
  RETURN jsonb_build_object('item',to_jsonb(r),'created',false,'suppressed',true);
 END IF;
 IF existed THEN
  IF NOT p_automatic THEN UPDATE cart_items SET removed_at=NULL,explicit_action_at=stamp,updated_at=stamp WHERE id=r.id RETURNING * INTO r; END IF;
 ELSE
  INSERT INTO cart_items(user_id,catalog_product_id,discovered_product_id,source_surface,source_content_source_id,source_user_import_id,
   source_collection_id,source_creator_id,source_collection_product_tag_id,explicit_action_at)
  VALUES(p_user,p_catalog,p_discovered,p_source->>'source_surface',(p_source->>'source_content_source_id')::uuid,
   (p_source->>'source_user_import_id')::uuid,(p_source->>'source_collection_id')::uuid,
   (p_source->>'source_creator_id')::uuid,(p_source->>'source_collection_product_tag_id')::uuid,CASE WHEN NOT p_automatic THEN stamp END)
  RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('item',to_jsonb(r),'created',NOT existed,'suppressed',r.removed_at IS NOT NULL);
END $$;

CREATE FUNCTION public.find_cart_remove(p_user uuid,p_catalog uuid,p_discovered uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existed boolean;
BEGIN
 IF (p_catalog IS NULL)=(p_discovered IS NULL) THEN RAISE EXCEPTION 'Invalid product identity' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('find-cart:'||p_user::text,0));
 SELECT EXISTS(SELECT 1 FROM cart_items WHERE user_id=p_user AND removed_at IS NULL AND
  (catalog_product_id=p_catalog OR discovered_product_id=p_discovered)) INTO existed;
 -- Also record removal when it races the first automatic insert.
 IF (p_catalog IS NOT NULL AND EXISTS(SELECT 1 FROM catalog_products WHERE id=p_catalog)) OR
    (p_discovered IS NOT NULL AND EXISTS(SELECT 1 FROM discovered_products WHERE id=p_discovered)) THEN
  INSERT INTO cart_items(user_id,catalog_product_id,discovered_product_id,removed_at,explicit_action_at)
  VALUES(p_user,p_catalog,p_discovered,clock_timestamp(),clock_timestamp())
  ON CONFLICT DO NOTHING;
  UPDATE cart_items SET removed_at=clock_timestamp(),explicit_action_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE user_id=p_user AND (catalog_product_id=p_catalog OR discovered_product_id=p_discovered);
 END IF;
 RETURN existed;
END $$;

CREATE FUNCTION public.find_cart_remap(p_source uuid,p_target uuid) RETURNS jsonb LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.cart_items; target public.cart_items; remapped integer:=0; collisions integer:=0;
BEGIN
 IF p_source=p_target THEN RETURN jsonb_build_object('remapped',0,'collisionsResolved',0); END IF;
 PERFORM id FROM catalog_products WHERE id IN (p_source,p_target) ORDER BY id FOR SHARE;
 FOR r IN SELECT * FROM cart_items WHERE catalog_product_id=p_source ORDER BY user_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('find-cart:'||r.user_id::text,0));
  SELECT * INTO r FROM cart_items WHERE id=r.id FOR UPDATE;
  IF NOT FOUND THEN CONTINUE; END IF;
  SELECT * INTO target FROM cart_items WHERE user_id=r.user_id AND catalog_product_id=p_target FOR UPDATE;
  IF FOUND THEN
   IF r.explicit_action_at IS NOT NULL AND (target.explicit_action_at IS NULL OR r.explicit_action_at>target.explicit_action_at OR (r.explicit_action_at=target.explicit_action_at AND r.removed_at IS NOT NULL)) THEN
    UPDATE cart_items SET removed_at=r.removed_at,explicit_action_at=r.explicit_action_at WHERE id=target.id;
   END IF;
   DELETE FROM cart_items WHERE id=r.id; collisions:=collisions+1;
  ELSE
   UPDATE cart_items SET catalog_product_id=p_target,updated_at=clock_timestamp() WHERE id=r.id; remapped:=remapped+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('remapped',remapped,'collisionsResolved',collisions);
END $$;

CREATE FUNCTION public.find_place_membership(p_user uuid,p_save uuid,p_restore boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.user_place_saves; h public.content_source_places;
BEGIN
 SELECT * INTO r FROM user_place_saves WHERE user_id=p_user AND
  id=coalesce((SELECT save_id FROM place_save_redirects WHERE old_save_id=p_save),p_save);
 IF NOT FOUND THEN RAISE EXCEPTION 'Place save not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO STRICT h FROM content_source_places WHERE id=r.content_source_place_id FOR UPDATE;
 IF h.place_id IS NOT NULL THEN PERFORM id FROM places WHERE id=h.place_id FOR UPDATE; END IF;
 IF p_restore AND h.retired_at IS NOT NULL THEN RAISE EXCEPTION 'Place result unavailable' USING ERRCODE='23514'; END IF;
 UPDATE user_place_saves SET removed_at=CASE WHEN NOT p_restore THEN clock_timestamp() END,
 explicit_action_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE user_id=p_user AND id=coalesce((SELECT save_id FROM place_save_redirects WHERE old_save_id=p_save),p_save) RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;

-- Preserve removal/provenance across extraction pruning; reappearance reuses the same hypothesis.
CREATE FUNCTION public.find_retire_place_hypotheses(p_source uuid,p_keep text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h public.content_source_places; count integer:=0;
BEGIN
 PERFORM import_work_assert();
 FOR h IN SELECT * FROM content_source_places WHERE content_source_id=p_source AND resolution_state='unresolved'
  AND retired_at IS NULL AND NOT(hypothesis_key=ANY(p_keep)) ORDER BY id FOR UPDATE LOOP
  UPDATE content_source_places SET retired_at=clock_timestamp() WHERE id=h.id;
  count:=count+1;
 END LOOP;
 RETURN count;
END $$;

-- Active results and current memberships are different counts. Removed rows satisfy delivery.
CREATE FUNCTION public.find_import_memberships(p_user uuid,p_imports uuid[])
RETURNS TABLE(import_id uuid,saved_products bigint,saved_places bigint,missing_products bigint,missing_places bigint,found_products bigint,found_places bigint,resolved_places bigint,unverified_places bigint,report jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH owned AS MATERIALIZED (SELECT id,content_source_id,stash_sync_state,stash_sync_attempt_id,attempt_started_at,created_at FROM user_imports WHERE user_id=p_user AND hidden_at IS NULL AND id=ANY(p_imports)),
 products AS MATERIALIZED (
  SELECT DISTINCT i.id,
   CASE WHEN coalesce(p.catalog_product_id,d.catalog_product_id) IS NOT NULL
    THEN 'c:'||coalesce(find_catalog_survivor(coalesce(p.catalog_product_id,d.catalog_product_id)),coalesce(p.catalog_product_id,d.catalog_product_id))::text
    ELSE 'd:'||p.discovered_product_id::text END AS key
  FROM owned i JOIN content_source_products p ON p.content_source_id=i.content_source_id
  LEFT JOIN discovered_products d ON d.id=p.discovered_product_id
  WHERE coalesce(p.catalog_product_id,p.discovered_product_id) IS NOT NULL
 ),
 cart AS MATERIALIZED (
  SELECT c.removed_at, CASE WHEN coalesce(c.catalog_product_id,d.catalog_product_id) IS NOT NULL
   THEN 'c:'||coalesce(find_catalog_survivor(coalesce(c.catalog_product_id,d.catalog_product_id)),coalesce(c.catalog_product_id,d.catalog_product_id))::text
   ELSE 'd:'||c.discovered_product_id::text END AS key
  FROM cart_items c LEFT JOIN discovered_products d ON d.id=c.discovered_product_id WHERE c.user_id=p_user
 ),
 hypotheses AS MATERIALIZED (
  SELECT DISTINCT i.id,CASE WHEN h.place_id IS NOT NULL THEN 'p:'||h.place_id::text ELSE 'h:'||h.id::text END AS key
  FROM owned i JOIN content_source_places h ON h.content_source_id=i.content_source_id WHERE h.retired_at IS NULL
 ),
 saves AS MATERIALIZED (
  SELECT s.removed_at,CASE WHEN s.place_id IS NOT NULL THEN 'p:'||s.place_id::text ELSE 'h:'||s.content_source_place_id::text END AS key
  FROM user_place_saves s WHERE s.user_id=p_user
 )
 SELECT i.id,
  (SELECT count(*) FROM products p WHERE p.id=i.id AND EXISTS(SELECT 1 FROM cart c WHERE c.key=p.key AND c.removed_at IS NULL)),
  (SELECT count(*) FROM hypotheses h WHERE h.id=i.id AND EXISTS(SELECT 1 FROM saves s WHERE s.key=h.key AND s.removed_at IS NULL)),
  (SELECT count(*) FROM products p WHERE p.id=i.id AND NOT EXISTS(SELECT 1 FROM cart c WHERE c.key=p.key)),
  (SELECT count(*) FROM hypotheses h WHERE h.id=i.id AND NOT EXISTS(SELECT 1 FROM saves s WHERE s.key=h.key)),
  (SELECT count(*) FROM products p WHERE p.id=i.id), (SELECT count(*) FROM hypotheses h WHERE h.id=i.id),
  (SELECT count(*) FROM hypotheses h WHERE h.id=i.id AND h.key LIKE 'p:%'),
  (SELECT count(*) FROM hypotheses h WHERE h.id=i.id AND h.key LIKE 'h:%'),
  jsonb_build_object('source',CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('processingStatus',s.processing_status,
    'mediaKind',s.media_kind,'queuedAt',s.queued_at) END,
   'progress',CASE WHEN progress.attempt_id IS NOT NULL THEN jsonb_build_object('attemptId',progress.attempt_id,
    'startedAt',progress.started_at,'finishedAt',progress.finished_at,'extractionVersion',progress.extraction_version,
    'products',progress.product_status,'places',progress.place_status,'evidenceComplete',progress.evidence_complete) END,
   'syncState',i.stash_sync_state,'syncAttemptId',i.stash_sync_attempt_id,'startedAt',coalesce(i.attempt_started_at,i.created_at))
 FROM owned i LEFT JOIN content_sources s ON s.id=i.content_source_id
 LEFT JOIN content_source_import_progress progress ON progress.content_source_id=i.content_source_id
$$;

CREATE OR REPLACE FUNCTION public.place_mark_resolved(p_hypothesis_id uuid,p_place_id uuid)
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
   IF s.explicit_action_at IS NOT NULL AND (survivor.explicit_action_at IS NULL OR s.explicit_action_at>survivor.explicit_action_at OR (s.explicit_action_at=survivor.explicit_action_at AND s.removed_at IS NOT NULL)) THEN
    UPDATE public.user_place_saves SET removed_at=s.removed_at,explicit_action_at=s.explicit_action_at WHERE id=survivor.id;
   END IF;
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


CREATE OR REPLACE FUNCTION public.place_attach_import(p_user_id uuid,p_hypothesis_id uuid,p_source_id uuid,p_import_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE h public.content_source_places; s public.user_place_saves;
BEGIN
 PERFORM public.import_work_assert();
 SELECT * INTO STRICT h FROM public.content_source_places WHERE id=p_hypothesis_id FOR UPDATE;
 IF h.retired_at IS NOT NULL THEN RAISE EXCEPTION 'Place result retired' USING ERRCODE='23514'; END IF;
 -- Match resolution lock ordering: hypothesis -> canonical -> import -> save.
 IF h.place_id IS NOT NULL THEN PERFORM id FROM public.places WHERE id=h.place_id FOR UPDATE; END IF;
 PERFORM id FROM public.user_imports WHERE id=p_import_id AND user_id=p_user_id
  AND content_source_id=p_source_id AND hidden_at IS NULL FOR SHARE;
 IF h.content_source_id<>p_source_id OR NOT FOUND THEN
  RAISE EXCEPTION 'Import does not own this source' USING ERRCODE='23514'; END IF;
 IF h.place_id IS NOT NULL THEN
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


CREATE OR REPLACE FUNCTION public.place_upsert_hypothesis(p_row jsonb)
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
 retired_at=NULL,extracted_name=EXCLUDED.extracted_name,category=EXCLUDED.category,locality=EXCLUDED.locality,city=EXCLUDED.city,
 region=EXCLUDED.region,country=EXCLUDED.country,mentioned_address=EXCLUDED.mentioned_address,
 confidence=EXCLUDED.confidence,evidence=EXCLUDED.evidence,sources=EXCLUDED.sources,updated_at=clock_timestamp(),
 unresolved_reason=CASE WHEN content_source_places.resolution_state='resolved' THEN NULL ELSE EXCLUDED.unresolved_reason END
 RETURNING * INTO h;
 RETURN to_jsonb(h);
END $$;


-- Membership decisions must pass through the authenticated API and atomic service RPCs.
-- Retain owner-scoped reads and RLS; direct writes could otherwise erase removal markers.
REVOKE INSERT,UPDATE,DELETE ON public.cart_items,public.user_place_saves FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.find_schema_version() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT 1 $$;

DO $$ DECLARE p regprocedure; BEGIN
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname IN ('find_schema_version','find_mark_sync_pending','find_finish_attempt','find_claim_stash_sync','find_finish_stash_sync',
  'find_catalog_survivor','find_cart_put','find_cart_remove','find_cart_remap','find_place_membership','find_retire_place_hypotheses','find_import_memberships',
  'place_mark_resolved','place_attach_import','place_upsert_hypothesis') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',p);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',p);
 END LOOP;
END $$;
COMMIT;
