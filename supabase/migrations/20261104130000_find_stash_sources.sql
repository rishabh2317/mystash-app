BEGIN;

-- Read only, owner-scoped projections. Existing Find and Stash contracts remain intact.
CREATE FUNCTION public.find_query_by_source_kind(p_user uuid,p_source text,p_saved_kind text,
 p_filter text DEFAULT 'all',p_limit integer DEFAULT 20,p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='25s' AS $$
DECLARE response jsonb;
BEGIN
 IF p_user IS NULL OR p_source IS NULL OR p_source NOT IN ('all','image','instagram','youtube','web')
  OR p_saved_kind IS NULL OR p_saved_kind NOT IN ('product','place')
  OR p_filter IS NULL OR p_filter NOT IN ('all','processing','completed','attention','saved')
  OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR (p_before IS NULL)<>(p_before_id IS NULL)
 THEN RAISE EXCEPTION 'Invalid Find query' USING ERRCODE='22023'; END IF;
 WITH scoped AS MATERIALIZED (
  SELECT * FROM public.find_read_rows(p_user)
  WHERE (p_source='all' OR item->>'sourceType'=p_source)
   AND CASE WHEN p_saved_kind='product' THEN (item->'outcome'->>'savedProducts')::bigint>0
     ELSE (item->'outcome'->>'savedPlaces')::bigint>0 END
 ), selected AS MATERIALIZED (
  SELECT * FROM scoped WHERE (p_filter='all' OR item->'outcome'->>'category'=p_filter
    OR (p_filter='saved' AND (item->'outcome'->>'savedProducts')::bigint+
      (item->'outcome'->>'savedPlaces')::bigint>0))
   AND (p_before IS NULL OR (created_at,id)<(p_before,p_before_id))
  ORDER BY created_at DESC,id DESC LIMIT p_limit+1
 ), page AS (SELECT * FROM selected ORDER BY created_at DESC,id DESC LIMIT p_limit)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb),
  'cursor',CASE WHEN (SELECT count(*) FROM selected)>p_limit THEN
   (SELECT jsonb_build_object('created_at',created_at,'id',id) FROM page ORDER BY created_at,id LIMIT 1) END,
  'counts',(SELECT jsonb_build_object('all',count(*),
   'processing',count(*) FILTER(WHERE item->'outcome'->>'category'='processing'),
   'completed',count(*) FILTER(WHERE item->'outcome'->>'category'='completed'),
   'attention',count(*) FILTER(WHERE item->'outcome'->>'category'='attention'),
   'saved',count(*) FILTER(WHERE (item->'outcome'->>'savedProducts')::bigint+
     (item->'outcome'->>'savedPlaces')::bigint>0)) FROM scoped)) INTO response;
 RETURN response;
END $$;

CREATE FUNCTION public.find_source_saved_rows(p_user uuid, p_import uuid)
RETURNS TABLE(result_key text, item jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='25s' AS $$
 WITH detail AS MATERIALIZED (SELECT public.find_detail(p_user,p_import) AS value),
 candidates AS (
  SELECT 'product:' || (p->>'identityKey') AS key, 0 AS priority,
   jsonb_build_object('kind','product','result',p) AS value
  FROM detail d CROSS JOIN LATERAL jsonb_array_elements(d.value->'products') p
  WHERE p->>'saved'='true' AND p->>'identityKey' IS NOT NULL
  UNION ALL
  SELECT 'product:' || (p->>'identityKey'), 1,
   jsonb_build_object('kind','product','result',p)
  FROM detail d CROSS JOIN LATERAL jsonb_array_elements(d.value->'savedSuggestions') p
  WHERE p->>'saved'='true' AND p->>'identityKey' IS NOT NULL
  UNION ALL
  SELECT 'place:' || coalesce(p->>'placeId',p->>'id'), 0,
   jsonb_build_object('kind','place','result',p)
  FROM detail d CROSS JOIN LATERAL jsonb_array_elements(d.value->'places') p
  WHERE p->>'saved'='true'
 ), unique_rows AS (
  SELECT DISTINCT ON (key) key,value FROM candidates ORDER BY key,priority
 )
 SELECT key,
  CASE WHEN (value->'result'->>'imageUrl') ~ '^https://[^/@?#]+(/[^?#]*)?$'
       AND (value->'result'->>'imageUrl') !~* 'find-private-images|[?&](token|signature)='
       AND position('?' IN (value->'result'->>'imageUrl'))=0
       AND position('#' IN (value->'result'->>'imageUrl'))=0
   THEN value ELSE jsonb_set(value,'{result,imageUrl}','null'::jsonb,true) END
 FROM unique_rows
$$;

CREATE FUNCTION public.find_source_results(p_user uuid,p_import uuid,p_limit integer DEFAULT 20,p_after text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='25s' AS $$
DECLARE response jsonb;
BEGIN
 IF p_user IS NULL OR p_import IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
   OR (p_after IS NOT NULL AND (length(p_after)>100 OR p_after !~ '^(place|product):[cd]?:?[0-9a-f-]{36}$'))
 THEN RAISE EXCEPTION 'Invalid source results query' USING ERRCODE='22023'; END IF;
 -- find_detail checks both owner and visibility before any result is projected.
 WITH selected AS MATERIALIZED (
  SELECT * FROM public.find_source_saved_rows(p_user,p_import)
  WHERE p_after IS NULL OR result_key>p_after ORDER BY result_key LIMIT p_limit+1
 ), page AS (SELECT * FROM selected ORDER BY result_key LIMIT p_limit)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(item ORDER BY result_key) FROM page),'[]'::jsonb),
  'cursor',CASE WHEN (SELECT count(*) FROM selected)>p_limit THEN (SELECT result_key FROM page ORDER BY result_key DESC LIMIT 1) END)
 INTO response;
 RETURN response;
END $$;

CREATE FUNCTION public.find_source_summaries(p_user uuid,p_kind text DEFAULT 'product',p_limit integer DEFAULT 20,
 p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='25s' AS $$
DECLARE response jsonb;
BEGIN
 IF p_user IS NULL OR p_kind IS NULL OR p_kind NOT IN ('product','place') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
  OR (p_before IS NULL)<>(p_before_id IS NULL) THEN RAISE EXCEPTION 'Invalid source summary query' USING ERRCODE='22023'; END IF;
 WITH eligible AS MATERIALIZED (
  SELECT * FROM public.find_read_rows(p_user)
  WHERE CASE WHEN p_kind='product' THEN (item->'outcome'->>'savedProducts')::bigint>0
    ELSE (item->'outcome'->>'savedPlaces')::bigint>0 END
 ), selected AS MATERIALIZED (
  SELECT * FROM eligible WHERE p_before IS NULL OR (created_at,id)<(p_before,p_before_id)
  ORDER BY created_at DESC,id DESC LIMIT p_limit+1
 ), page AS MATERIALIZED (SELECT * FROM selected ORDER BY created_at DESC,id DESC LIMIT p_limit),
 page_ids AS (SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) AS ids FROM page),
 saved_cart AS MATERIALIZED (
  SELECT DISTINCT public.find_product_key(c.catalog_product_id,c.discovered_product_id) AS key
  FROM cart_items c WHERE c.user_id=p_user AND c.removed_at IS NULL
 ), saved_places AS MATERIALIZED (
  SELECT DISTINCT CASE WHEN s.place_id IS NOT NULL THEN 'p:'||s.place_id::text ELSE 'h:'||s.content_source_place_id::text END AS key
  FROM user_place_saves s WHERE s.user_id=p_user AND s.removed_at IS NULL
 ), preview_candidates AS (
  SELECT p.id AS import_id,'product:'||public.find_product_key(c.catalog_product_id,c.discovered_product_id) AS key,
   0 AS priority,c.image AS media
  FROM page p JOIN content_source_products c ON c.content_source_id=(p.item->>'contentSourceId')::uuid
  JOIN saved_cart s ON s.key=public.find_product_key(c.catalog_product_id,c.discovered_product_id)
  WHERE c.catalog_product_id IS NOT NULL OR c.discovered_product_id IS NOT NULL
  UNION ALL
  SELECT r.import_id,'product:'||r.identity_key,1,r.image_url
  FROM public.find_selected_products(p_user,(SELECT ids FROM page_ids)) r JOIN saved_cart s ON s.key=r.identity_key
  UNION ALL
  SELECT p.id,'place:'||coalesce(h.place_id,h.id)::text,2,p.item->>'thumbnailUrl'
  FROM page p JOIN content_source_places h ON h.content_source_id=(p.item->>'contentSourceId')::uuid AND h.retired_at IS NULL
  JOIN saved_places s ON s.key=CASE WHEN h.place_id IS NOT NULL THEN 'p:'||h.place_id::text ELSE 'h:'||h.id::text END
 ), preview_unique AS (
  SELECT DISTINCT ON (import_id,key) import_id,key,media FROM preview_candidates ORDER BY import_id,key,priority
 ), previews AS (
  SELECT import_id,row_number() OVER(PARTITION BY import_id ORDER BY key) AS ordinal,
   CASE WHEN media ~ '^https://[^/@?#]+(/[^?#]*)?$' AND media !~* 'find-private-images|[?&](token|signature)='
     AND position('?' IN media)=0 AND position('#' IN media)=0 THEN to_jsonb(media) ELSE 'null'::jsonb END AS safe_image
  FROM preview_unique
 )
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'id',p.id,'createdAt',p.created_at,'title',p.item->'title','sourceType',p.item->'sourceType',
  'savedProducts',(p.item->'outcome'->>'savedProducts')::bigint,
  'savedPlaces',(p.item->'outcome'->>'savedPlaces')::bigint,
  'images',coalesce((SELECT jsonb_agg(r.safe_image ORDER BY r.ordinal)
    FROM previews r WHERE r.import_id=p.id AND r.ordinal<=4),'[]'::jsonb)
 ) ORDER BY p.created_at DESC,p.id DESC) FROM page p),'[]'::jsonb),
  'cursor',CASE WHEN (SELECT count(*) FROM selected)>p_limit THEN
   (SELECT jsonb_build_object('created_at',created_at,'id',id) FROM page ORDER BY created_at,id LIMIT 1) END)
 INTO response;
 RETURN response;
END $$;

DO $$ DECLARE p regprocedure; BEGIN
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN ('find_query_by_source_kind','find_source_saved_rows','find_source_results','find_source_summaries') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',p);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',p);
 END LOOP;
END $$;
COMMIT;
