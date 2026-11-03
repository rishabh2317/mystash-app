-- Phase 2: one database outcome projection for paginated Find reads and global counts.
-- Source only until a separately approved rollout. No backfill or destructive data changes.
BEGIN;

CREATE FUNCTION public.find_project_outcome(m jsonb,p_now timestamptz DEFAULT statement_timestamp()) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH report AS (SELECT m->'report' r), facts AS (
  SELECT r,r->'source' s,CASE WHEN r->'progress'<>'null'::jsonb AND
   (r->'source'->>'queuedAt' IS NULL OR (r->'progress'->>'startedAt')::timestamptz >= (r->'source'->>'queuedAt')::timestamptz)
   THEN r->'progress' END p FROM report
 ), branches AS (
  SELECT *,s->>'processingStatus' IN ('READY','FAILED') AS terminal,
   coalesce(p->>'products',CASE s->>'processingStatus' WHEN 'FAILED' THEN 'failed' WHEN 'READY' THEN 'complete' ELSE 'running' END) AS products,
   coalesce(p->>'places',CASE WHEN s->>'mediaKind'='WEB_PAGE' THEN 'complete' WHEN s->>'processingStatus'='FAILED' THEN 'failed' WHEN s->>'processingStatus'='READY' THEN 'complete' ELSE 'running' END) AS places,
   s IS NULL OR s='null'::jsonb OR r->>'syncState' IS NULL AS incomplete
  FROM facts
 ), state AS (
  SELECT *,coalesce(NOT terminal,true) OR products='running' OR places='running' AS running,
   products='failed' OR places='failed' OR s->>'processingStatus'='FAILED' AS failed,
   (m->>'found_products')::bigint+(m->>'found_places')::bigint>0 AS found,
   CASE WHEN (p IS NOT NULL AND (r->>'syncAttemptId') IS DISTINCT FROM (p->>'attemptId'))
    OR (m->>'missing_products')::bigint+(m->>'missing_places')::bigint>0
    THEN CASE WHEN r->>'syncState'='failed' AND NOT (p IS NOT NULL AND (r->>'syncAttemptId') IS DISTINCT FROM (p->>'attemptId')) THEN 'failed' ELSE 'pending' END
    ELSE r->>'syncState' END AS sync
  FROM branches
 ), outcome AS (
  SELECT *,running AND p_now-greatest((r->>'startedAt')::timestamptz,(s->>'queuedAt')::timestamptz,(p->>'startedAt')::timestamptz)>=interval '10 minutes' AS delayed
  FROM state
 )
 SELECT jsonb_build_object('version',1,
  'category',CASE WHEN incomplete THEN 'attention' WHEN running THEN CASE WHEN delayed THEN 'attention' ELSE 'processing' END
    WHEN failed OR sync='failed' THEN 'attention' WHEN sync<>'complete' THEN 'processing' ELSE 'completed' END,
  'result',CASE WHEN incomplete THEN 'failed' WHEN found THEN CASE WHEN failed THEN 'partial' ELSE 'found' END
    WHEN running THEN 'pending' WHEN failed THEN 'failed' ELSE 'empty' END,
  'products',CASE WHEN incomplete THEN 'unknown' ELSE products END,'places',CASE WHEN incomplete THEN 'unknown' ELSE places END,
  'foundProducts',(m->>'found_products')::bigint,'foundPlaces',(m->>'found_places')::bigint,
  'resolvedPlaces',(m->>'resolved_places')::bigint,'unverifiedPlaces',(m->>'unverified_places')::bigint,
  'savedProducts',(m->>'saved_products')::bigint,'savedPlaces',(m->>'saved_places')::bigint,
  'stashSync',CASE WHEN incomplete THEN 'unavailable' ELSE sync END,
  'extractionActive',NOT incomplete AND running,'delayed',NOT incomplete AND delayed,
  'canRetryExtraction',CASE WHEN incomplete THEN coalesce(terminal,false) ELSE terminal AND NOT running AND failed END,
  'canRetrySaving',NOT incomplete AND terminal AND NOT running AND sync IN ('pending','failed'),
  'finishedAt',CASE WHEN NOT incomplete AND terminal AND NOT running THEN p->'finishedAt' ELSE 'null'::jsonb END)
 FROM outcome
$$;

CREATE FUNCTION public.find_product_key(p_catalog uuid,p_discovered uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN coalesce(p_catalog,d.catalog_product_id) IS NOT NULL
 THEN 'c:'||coalesce(find_catalog_survivor(coalesce(p_catalog,d.catalog_product_id)),coalesce(p_catalog,d.catalog_product_id))::text
 ELSE 'd:'||p_discovered::text END FROM (SELECT 1) v LEFT JOIN discovered_products d ON d.id=p_discovered
$$;

-- Accepted similar candidates remain user-approved identities, never relabeled exact.
CREATE FUNCTION public.find_selected_products(p_user uuid,p_imports uuid[])
RETURNS TABLE(import_id uuid,source_product_id uuid,candidate_key text,identity_key text,title text,image_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT r.import_id,r.source_product_id,r.candidate_key,
  CASE WHEN c.id IS NOT NULL AND d.id IS NULL THEN find_product_key(c.id,NULL)
       WHEN d.id IS NOT NULL AND c.id IS NULL THEN find_product_key(NULL,d.id) END,
  coalesce(to_jsonb(c)->>'name',d.name,p.name),coalesce(c.image_url,d.image_url,p.image)
 FROM user_import_product_reviews r JOIN user_imports i ON i.id=r.import_id AND i.user_id=p_user AND i.hidden_at IS NULL
 JOIN content_source_products p ON p.id=r.source_product_id AND p.content_source_id=i.content_source_id
 LEFT JOIN catalog_products c ON c.id=r.product_id LEFT JOIN discovered_products d ON d.id=r.product_id
 WHERE r.user_id=p_user AND r.import_id=ANY(p_imports) AND r.state='accepted'
$$;

CREATE FUNCTION public.find_outcome_memberships(p_user uuid,p_imports uuid[]) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH base AS MATERIALIZED (SELECT * FROM find_import_memberships(p_user,p_imports)),
 products AS MATERIALIZED (
  SELECT DISTINCT m.import_id,find_product_key(p.catalog_product_id,p.discovered_product_id) AS key
  FROM base m JOIN user_imports i ON i.id=m.import_id JOIN content_source_products p ON p.content_source_id=i.content_source_id
  WHERE p.catalog_product_id IS NOT NULL OR p.discovered_product_id IS NOT NULL
  UNION SELECT import_id,identity_key FROM find_selected_products(p_user,p_imports) WHERE identity_key IS NOT NULL
 ), cart AS MATERIALIZED (SELECT find_product_key(c.catalog_product_id,c.discovered_product_id) AS key,c.removed_at FROM cart_items c WHERE c.user_id=p_user),
 augmented AS (
  SELECT to_jsonb(m)||jsonb_build_object('selected_products',coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('productId',substring(r.identity_key FROM 3),'title',r.title,'imageUrl',r.image_url)) FROM find_selected_products(p_user,ARRAY[m.import_id]) r WHERE r.identity_key IS NOT NULL),'[]'::jsonb),'found_products',(SELECT count(*) FROM products p WHERE p.import_id=m.import_id),
   'saved_products',(SELECT count(*) FROM products p WHERE p.import_id=m.import_id AND EXISTS(SELECT 1 FROM cart c WHERE c.key=p.key AND c.removed_at IS NULL)),
   'missing_products',(SELECT count(*) FROM products p WHERE p.import_id=m.import_id AND NOT EXISTS(SELECT 1 FROM cart c WHERE c.key=p.key))) AS row FROM base m
 ) SELECT row||jsonb_build_object('outcome',find_project_outcome(row)) FROM augmented
$$;

CREATE FUNCTION public.find_read_rows(p_user uuid,p_ids uuid[] DEFAULT NULL)
RETURNS TABLE(id uuid,created_at timestamptz,item jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH owned AS MATERIALIZED (SELECT * FROM user_imports WHERE user_id=p_user AND hidden_at IS NULL AND (p_ids IS NULL OR id=ANY(p_ids))),
 memberships AS MATERIALIZED (SELECT m FROM find_outcome_memberships(p_user,coalesce((SELECT array_agg(id) FROM owned),ARRAY[]::uuid[])) m)
 SELECT i.id,i.created_at,jsonb_build_object('id',i.id,'createdAt',i.created_at,'sourceUrl',i.source_url,
  'sourceType',CASE WHEN i.platform IN ('instagram','youtube') THEN i.platform ELSE 'web' END,
  'contentSourceId',i.content_source_id,'title',s.title,'thumbnailUrl',s.thumbnail_url,'outcome',m.m->'outcome',
  'intent',jsonb_build_object('kind',i.interest_kind,'note',i.interest_note,'revision',i.intent_revision))
 FROM owned i JOIN memberships m ON (m.m->>'import_id')::uuid=i.id LEFT JOIN content_sources s ON s.id=i.content_source_id
$$;

CREATE FUNCTION public.find_query(p_user uuid,p_mode text DEFAULT 'list',p_limit integer DEFAULT 20,
 p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_filter text DEFAULT 'all',p_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='25s' AS $$
DECLARE result jsonb;
BEGIN
 IF p_user IS NULL OR p_mode IS NULL OR p_mode NOT IN ('list','counts','batch') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
 OR p_filter IS NULL OR p_filter NOT IN ('all','processing','completed','attention','saved')
 OR (p_before IS NULL)<>(p_before_id IS NULL)
 OR (p_mode='batch' AND (p_ids IS NULL OR cardinality(p_ids)>100)) THEN RAISE EXCEPTION 'Invalid Find query' USING ERRCODE='22023'; END IF;
 WITH rows AS MATERIALIZED (SELECT * FROM find_read_rows(p_user,CASE WHEN p_mode='batch' THEN p_ids END)),
 selected AS MATERIALIZED (
  SELECT * FROM rows WHERE p_mode<>'counts' AND
   (p_filter='all' OR item->'outcome'->>'category'=p_filter OR (p_filter='saved' AND
    (item->'outcome'->>'savedProducts')::bigint+(item->'outcome'->>'savedPlaces')::bigint>0))
   AND (p_before IS NULL OR (created_at,id)<(p_before,p_before_id))
  ORDER BY created_at DESC,id DESC LIMIT CASE WHEN p_mode='batch' THEN 100 ELSE p_limit+1 END
 ), page AS (SELECT * FROM selected ORDER BY created_at DESC,id DESC LIMIT CASE WHEN p_mode='batch' THEN 100 ELSE p_limit END)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb),
  'cursor',CASE WHEN p_mode='list' AND (SELECT count(*) FROM selected)>p_limit THEN
   (SELECT jsonb_build_object('created_at',created_at,'id',id) FROM page ORDER BY created_at,id LIMIT 1) END,
  'counts',CASE WHEN p_mode<>'batch' THEN (SELECT jsonb_build_object('all',count(*),
   'processing',count(*) FILTER (WHERE item->'outcome'->>'category'='processing'),
   'completed',count(*) FILTER (WHERE item->'outcome'->>'category'='completed'),
   'attention',count(*) FILTER (WHERE item->'outcome'->>'category'='attention'),
   'saved',count(*) FILTER (WHERE (item->'outcome'->>'savedProducts')::bigint+(item->'outcome'->>'savedPlaces')::bigint>0)) FROM rows) END)
 INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.find_detail(p_user uuid,p_import uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='25s' AS $$
DECLARE result jsonb; source uuid;
BEGIN
 SELECT item,(item->>'contentSourceId')::uuid INTO result,source FROM find_read_rows(p_user,ARRAY[p_import]);
 IF result IS NULL THEN RAISE EXCEPTION 'find_not_found' USING ERRCODE='P0002'; END IF;
 WITH cart AS MATERIALIZED (
  SELECT find_product_key(c.catalog_product_id,c.discovered_product_id) AS key,
   bool_or(c.removed_at IS NULL) AS saved,bool_or(c.removed_at IS NOT NULL) AS removed FROM cart_items c WHERE c.user_id=p_user GROUP BY 1
 ), saves AS MATERIALIZED (
  SELECT CASE WHEN s.place_id IS NOT NULL THEN 'p:'||s.place_id::text ELSE 'h:'||s.content_source_place_id::text END AS key,
   bool_or(s.removed_at IS NULL) AS saved,bool_or(s.removed_at IS NOT NULL) AS removed FROM user_place_saves s WHERE s.user_id=p_user GROUP BY 1
 )
 SELECT result||jsonb_build_object(
  'products',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'title',p.name,'imageUrl',p.image,
   'catalogProductId',CASE WHEN p.catalog_product_id IS NOT NULL THEN coalesce(find_catalog_survivor(p.catalog_product_id),p.catalog_product_id) END,
   'discoveredProductId',p.discovered_product_id,'identityKey',CASE WHEN p.catalog_product_id IS NOT NULL OR p.discovered_product_id IS NOT NULL THEN find_product_key(p.catalog_product_id,p.discovered_product_id) END,
   'matchKind',CASE WHEN p.catalog_product_id IS NOT NULL OR p.discovered_product_id IS NOT NULL THEN 'exact' ELSE coalesce(p.match_assessment->>'kind','unable_to_identify') END,
   'saved',coalesce(c.saved,false),'removed',coalesce(c.removed,false) AND NOT coalesce(c.saved,false)) ORDER BY p.position,p.id)
   FROM content_source_products p LEFT JOIN cart c ON c.key=find_product_key(p.catalog_product_id,p.discovered_product_id)
   WHERE p.content_source_id=source),'[]'::jsonb),
  'places',coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'name',h.extracted_name,'placeId',h.place_id,
   'resolution',h.resolution_state,'locality',h.locality,'city',h.city,
   'saved',coalesce(s.saved,false),'removed',coalesce(s.removed,false) AND NOT coalesce(s.saved,false)) ORDER BY h.id)
   FROM content_source_places h LEFT JOIN saves s ON s.key=CASE WHEN h.place_id IS NOT NULL THEN 'p:'||h.place_id::text ELSE 'h:'||h.id::text END
   WHERE h.content_source_id=source AND h.retired_at IS NULL),'[]'::jsonb),
  'savedSuggestions',coalesce((SELECT jsonb_agg(jsonb_build_object('sourceProductId',r.source_product_id,'candidateKey',r.candidate_key,
   'identityKey',r.identity_key,'title',r.title,'imageUrl',r.image_url,'matchKind','similar',
   'saved',coalesce(c.saved,false),'removed',coalesce(c.removed,false) AND NOT coalesce(c.saved,false)) ORDER BY r.source_product_id,r.candidate_key)
   FROM find_selected_products(p_user,ARRAY[p_import]) r LEFT JOIN cart c ON c.key=r.identity_key WHERE r.identity_key IS NOT NULL),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.find_result_action(p_user uuid,p_import uuid,p_kind text,p_result uuid,p_restore boolean,p_expected text DEFAULT NULL,p_candidate text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE i public.user_imports; product public.content_source_products; h public.content_source_places;
 catalog uuid; discovered uuid; key text; saved jsonb;
BEGIN
 IF p_restore IS NULL OR p_kind IS NULL OR p_kind NOT IN ('product','place') THEN RAISE EXCEPTION 'Invalid Find action' USING ERRCODE='22023'; END IF;
 SELECT * INTO i FROM user_imports WHERE id=p_import AND user_id=p_user AND hidden_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'find_not_found' USING ERRCODE='P0002'; END IF;
 IF p_kind='product' THEN
  SELECT * INTO product FROM content_source_products WHERE id=p_result AND content_source_id=i.content_source_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'find_result_not_found' USING ERRCODE='P0002'; END IF;
  IF p_candidate IS NOT NULL THEN
   PERFORM r.source_product_id FROM user_import_product_reviews r WHERE r.user_id=p_user AND r.import_id=i.id
    AND r.source_product_id=product.id AND r.candidate_key=p_candidate AND r.state='accepted' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'find_result_not_found' USING ERRCODE='P0002'; END IF;
   SELECT identity_key INTO key FROM find_selected_products(p_user,ARRAY[i.id]) WHERE source_product_id=product.id AND candidate_key=p_candidate;
   IF key IS NULL THEN RAISE EXCEPTION 'Selected identity unavailable' USING ERRCODE='23514'; END IF;
  ELSE
   IF product.catalog_product_id IS NULL AND product.discovered_product_id IS NULL THEN RAISE EXCEPTION 'Result has no eligible identity' USING ERRCODE='23514'; END IF;
   key:=find_product_key(product.catalog_product_id,product.discovered_product_id);
  END IF;
  IF p_expected IS NULL OR p_expected !~ '^[cd]:[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'Product identity changed' USING ERRCODE='23514'; END IF;
  IF find_product_key(CASE WHEN left(p_expected,1)='c' THEN substring(p_expected FROM 3)::uuid END,
   CASE WHEN left(p_expected,1)='d' THEN substring(p_expected FROM 3)::uuid END) IS DISTINCT FROM key THEN
   RAISE EXCEPTION 'Product identity changed' USING ERRCODE='23514'; END IF;
  IF key LIKE 'c:%' THEN catalog:=substring(key FROM 3)::uuid; ELSE discovered:=substring(key FROM 3)::uuid; END IF;
  IF p_restore THEN
   PERFORM find_cart_put(p_user,catalog,discovered,jsonb_build_object('source_surface','USER_IMPORT','source_user_import_id',i.id,'source_content_source_id',i.content_source_id),false);
  ELSE
   -- Match the existing automatic-save lock order: user advisory -> import -> membership.
   PERFORM pg_advisory_xact_lock(hashtextextended('find-cart:'||p_user::text,0));
   PERFORM id FROM user_imports WHERE id=i.id AND user_id=p_user AND hidden_at IS NULL FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'find_not_found' USING ERRCODE='P0002'; END IF;
   PERFORM find_cart_remove(p_user,catalog,discovered);
  END IF;
  -- One explicit decision applies to every already-known identity alias.
  UPDATE cart_items c SET removed_at=CASE WHEN NOT p_restore THEN clock_timestamp() END,
   explicit_action_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE c.user_id=p_user AND find_product_key(c.catalog_product_id,c.discovered_product_id)=key;
 ELSE
  SELECT * INTO h FROM content_source_places WHERE id=p_result AND content_source_id=i.content_source_id AND retired_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'find_result_not_found' USING ERRCODE='P0002'; END IF;
  -- Reuse hypothesis/canonical/import/save locks and attribution. Do not lock an unrelated
  -- original hypothesis after the canonical row: promotion may be holding it already.
  saved:=place_attach_import(p_user,h.id,i.content_source_id,i.id);
  UPDATE user_place_saves SET removed_at=CASE WHEN NOT p_restore THEN clock_timestamp() END,
   explicit_action_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=(saved->>'id')::uuid AND user_id=p_user;
 END IF;
 RETURN jsonb_build_object('ok',true,'saved',p_restore);
END $$;

-- Commit the existing suggestion receipt and membership together. A lost acknowledgement
-- must not turn a replay into an explicit restoration after the user removes the item.
CREATE FUNCTION public.find_accept_suggestion(p_user uuid,p_import uuid,p_source uuid,p_key text,p_lease uuid,p_catalog uuid,p_discovered uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE r public.user_import_product_reviews; imported public.user_imports; cart jsonb;
BEGIN
 SELECT * INTO imported FROM user_imports WHERE id=p_import AND user_id=p_user AND hidden_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'find_not_found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM user_import_product_reviews WHERE user_id=p_user AND import_id=p_import AND source_product_id=p_source AND candidate_key=p_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'find_result_not_found' USING ERRCODE='P0002'; END IF;
 IF r.state='accepted' THEN RETURN jsonb_build_object('state','accepted','productId',r.product_id); END IF;
 IF (p_catalog IS NULL)=(p_discovered IS NULL) THEN RAISE EXCEPTION 'Invalid identity' USING ERRCODE='23514'; END IF;
 PERFORM id FROM content_source_products WHERE id=p_source AND content_source_id=imported.content_source_id
  AND catalog_product_id IS NULL AND discovered_product_id IS NULL
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(match_assessment->'suggestions','[]'::jsonb)) c WHERE c->>'key'=p_key) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Suggestion changed' USING ERRCODE='23514'; END IF;
 IF p_catalog IS NOT NULL THEN PERFORM id FROM catalog_products WHERE id=p_catalog FOR SHARE;
 ELSE PERFORM id FROM discovered_products WHERE id=p_discovered FOR SHARE; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('find-cart:'||p_user::text,0));
 PERFORM id FROM user_imports WHERE id=p_import AND user_id=p_user AND hidden_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'find_not_found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO STRICT r FROM user_import_product_reviews WHERE user_id=p_user AND import_id=p_import AND source_product_id=p_source AND candidate_key=p_key FOR UPDATE;
 IF r.state='accepted' THEN RETURN jsonb_build_object('state','accepted','productId',r.product_id); END IF;
 IF p_lease IS NULL OR r.lease_until IS NULL OR r.state<>'accepting' OR r.lease_id IS DISTINCT FROM p_lease OR r.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Review lease expired' USING ERRCODE='23514'; END IF;
 cart:=find_cart_put(p_user,p_catalog,p_discovered,jsonb_build_object('source_surface','USER_IMPORT','source_user_import_id',p_import,'source_content_source_id',imported.content_source_id),false);
 UPDATE user_import_product_reviews SET state='accepted',product_id=coalesce(p_catalog,p_discovered),lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE user_id=p_user AND import_id=p_import AND source_product_id=p_source AND candidate_key=p_key;
 RETURN jsonb_build_object('state','accepted','productId',coalesce(p_catalog,p_discovered),'cart',cart);
END $$;

CREATE OR REPLACE FUNCTION public.find_schema_version() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT 2 $$;
DO $$ DECLARE p regprocedure; BEGIN
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('find_accept_suggestion','find_selected_products','find_project_outcome','find_outcome_memberships','find_read_rows','find_query','find_product_key','find_detail','find_result_action') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',p);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',p);
 END LOOP;
END $$;
COMMIT;
