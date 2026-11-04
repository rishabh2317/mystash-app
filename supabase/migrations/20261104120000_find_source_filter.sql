BEGIN;

-- New read contract; leave find_query unchanged for deployed clients and workers.
CREATE FUNCTION public.find_query_by_source(
  p_user uuid, p_source text, p_filter text DEFAULT 'all', p_limit integer DEFAULT 20,
  p_before timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='25s' AS $$
DECLARE result jsonb;
BEGIN
  IF p_user IS NULL OR p_source IS NULL OR p_source NOT IN ('all','image','instagram','youtube','web')
    OR p_filter IS NULL OR p_filter NOT IN ('all','processing','completed','attention','saved')
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR (p_before IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid Find query' USING ERRCODE='22023';
  END IF;

  WITH source_rows AS MATERIALIZED (
    SELECT * FROM public.find_read_rows(p_user)
    WHERE p_source='all' OR item->>'sourceType'=p_source
  ), selected AS MATERIALIZED (
    SELECT * FROM source_rows
    WHERE (p_filter='all' OR item->'outcome'->>'category'=p_filter
      OR (p_filter='saved' AND
        (item->'outcome'->>'savedProducts')::bigint+(item->'outcome'->>'savedPlaces')::bigint>0))
      AND (p_before IS NULL OR (created_at,id)<(p_before,p_before_id))
    ORDER BY created_at DESC,id DESC LIMIT p_limit+1
  ), page AS (
    SELECT * FROM selected ORDER BY created_at DESC,id DESC LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'items',coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb),
    'cursor',CASE WHEN (SELECT count(*) FROM selected)>p_limit THEN
      (SELECT jsonb_build_object('created_at',created_at,'id',id) FROM page ORDER BY created_at,id LIMIT 1) END,
    'counts',(SELECT jsonb_build_object('all',count(*),
      'processing',count(*) FILTER (WHERE item->'outcome'->>'category'='processing'),
      'completed',count(*) FILTER (WHERE item->'outcome'->>'category'='completed'),
      'attention',count(*) FILTER (WHERE item->'outcome'->>'category'='attention'),
      'saved',count(*) FILTER (WHERE (item->'outcome'->>'savedProducts')::bigint+
        (item->'outcome'->>'savedPlaces')::bigint>0)) FROM source_rows)
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.find_query_by_source(uuid,text,text,integer,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.find_query_by_source(uuid,text,text,integer,timestamptz,uuid) TO service_role;
COMMIT;
