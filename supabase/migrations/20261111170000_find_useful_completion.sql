-- Result-first completion. No data reprocessing, deletion or new client permissions.
BEGIN;
CREATE OR REPLACE FUNCTION public.find_project_outcome(m jsonb,p_now timestamptz DEFAULT statement_timestamp()) RETURNS jsonb
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
   (m->>'found_products')::bigint+(m->>'found_places')::bigint+coalesce((m->>'discovery_products')::bigint,0)>0 AS found,
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
  'category',CASE WHEN incomplete THEN 'attention' WHEN running THEN 'processing'
    WHEN sync='failed' OR (failed AND NOT found) THEN 'attention' WHEN sync<>'complete' THEN 'processing' ELSE 'completed' END,
  'result',CASE WHEN incomplete THEN 'failed' WHEN found THEN CASE WHEN failed THEN 'partial' ELSE 'found' END
    WHEN running THEN 'pending' WHEN failed THEN 'failed' ELSE 'empty' END,
  'products',CASE WHEN incomplete THEN 'unknown' ELSE products END,'places',CASE WHEN incomplete THEN 'unknown' ELSE places END,
  'discoveryProducts',coalesce((m->>'discovery_products')::bigint,0),'foundProducts',(m->>'found_products')::bigint,'foundPlaces',(m->>'found_places')::bigint,
  'resolvedPlaces',(m->>'resolved_places')::bigint,'unverifiedPlaces',(m->>'unverified_places')::bigint,
  'savedProducts',(m->>'saved_products')::bigint,'savedPlaces',(m->>'saved_places')::bigint,
  'stashSync',CASE WHEN incomplete THEN 'unavailable' ELSE sync END,
  'extractionActive',NOT incomplete AND running,'delayed',NOT incomplete AND delayed,
  'canRetryExtraction',CASE WHEN incomplete THEN coalesce(terminal,false) ELSE terminal AND NOT running AND failed END,
  'canRetrySaving',NOT incomplete AND terminal AND NOT running AND sync IN ('pending','failed'),
  'finishedAt',CASE WHEN NOT incomplete AND terminal AND NOT running THEN p->'finishedAt' ELSE 'null'::jsonb END)
 FROM outcome
$$;

REVOKE ALL ON FUNCTION public.find_project_outcome(jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.find_project_outcome(jsonb,timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION public.find_outcome_memberships(p_user uuid,p_imports uuid[]) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH base AS MATERIALIZED (SELECT * FROM find_import_memberships(p_user,p_imports)),
 discovery_counts AS MATERIALIZED (
  SELECT p.content_source_id,count(*) AS count FROM content_source_products p
  WHERE p.content_source_id IN (SELECT i.content_source_id FROM base m JOIN user_imports i ON i.id=m.import_id)
   AND p.catalog_product_id IS NULL AND p.discovered_product_id IS NULL AND p.evidence->'discoveryEligible'='true'::jsonb
  GROUP BY p.content_source_id
 ),
 products AS MATERIALIZED (
  SELECT DISTINCT m.import_id,find_product_key(p.catalog_product_id,p.discovered_product_id) AS key
  FROM base m JOIN user_imports i ON i.id=m.import_id JOIN content_source_products p ON p.content_source_id=i.content_source_id
  WHERE p.catalog_product_id IS NOT NULL OR p.discovered_product_id IS NOT NULL
  UNION SELECT import_id,identity_key FROM find_selected_products(p_user,p_imports) WHERE identity_key IS NOT NULL
 ), cart AS MATERIALIZED (SELECT find_product_key(c.catalog_product_id,c.discovered_product_id) AS key,c.removed_at FROM cart_items c WHERE c.user_id=p_user),
 augmented AS (
  SELECT to_jsonb(m)||jsonb_build_object('discovery_products',coalesce(d.count,0),'selected_products',coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('productId',substring(r.identity_key FROM 3),'title',r.title,'imageUrl',r.image_url)) FROM find_selected_products(p_user,ARRAY[m.import_id]) r WHERE r.identity_key IS NOT NULL),'[]'::jsonb),'found_products',(SELECT count(*) FROM products p WHERE p.import_id=m.import_id),
   'saved_products',(SELECT count(*) FROM products p WHERE p.import_id=m.import_id AND EXISTS(SELECT 1 FROM cart c WHERE c.key=p.key AND c.removed_at IS NULL)),
   'missing_products',(SELECT count(*) FROM products p WHERE p.import_id=m.import_id AND NOT EXISTS(SELECT 1 FROM cart c WHERE c.key=p.key))) AS row FROM base m JOIN user_imports i ON i.id=m.import_id LEFT JOIN discovery_counts d ON d.content_source_id=i.content_source_id
 ) SELECT row||jsonb_build_object('outcome',find_project_outcome(row)) FROM augmented
$$;

REVOKE ALL ON FUNCTION public.find_outcome_memberships(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.find_outcome_memberships(uuid,uuid[]) TO service_role;
CREATE OR REPLACE FUNCTION public.find_detail(p_user uuid,p_import uuid) RETURNS jsonb
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
   'discoverySeed',jsonb_build_object('brand',p.brand,'attributes',coalesce((SELECT jsonb_agg(jsonb_build_object('attribute',a->>'attribute','value',a->>'value','origin',a->>'origin'))
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.evidence->'attributes')='array' THEN p.evidence->'attributes' ELSE '[]'::jsonb END) a
    WHERE a->>'attribute' IN ('brand','brandText') AND a->>'origin' IN ('source_text','observed')),'[]'::jsonb)),
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

REVOKE ALL ON FUNCTION public.find_detail(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.find_detail(uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.find_schema_version() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT 5 $$;
REVOKE ALL ON FUNCTION public.find_schema_version() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.find_schema_version() TO service_role;
COMMIT;
