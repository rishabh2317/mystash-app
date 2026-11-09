-- A bounded, complete-UTC-day range for creator reports. Existing preset RPC remains unchanged.
CREATE FUNCTION public.analytics_creator_report_range(p_creator_id uuid, p_start date, p_end date)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p_days integer := p_end - p_start; result jsonb;
BEGIN
 IF p_creator_id IS NULL OR p_start IS NULL OR p_end IS NULL OR p_days NOT BETWEEN 1 AND 90
  OR p_end > (now() AT TIME ZONE 'UTC')::date THEN
  RAISE EXCEPTION 'Invalid range' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_creator_id AND creator_status<>'NONE'
  AND deleted_at IS NULL AND account_status<>'DELETED') THEN
  RAISE EXCEPTION 'Creator unavailable' USING ERRCODE='42501';
 END IF;
 WITH scoped AS MATERIALIZED (
  SELECT d.* FROM public.analytics_creator_daily d
  LEFT JOIN public.collections c ON c.id=d.collection_key AND c.creator_id=p_creator_id
   AND c.status='published' AND c.visibility='public' AND c.moderation_state='clear' AND c.deleted_at IS NULL
  WHERE d.creator_id=p_creator_id AND d.day>=p_start-p_days AND d.day<p_end
   AND (d.collection_key='00000000-0000-0000-0000-000000000000' OR c.id IS NOT NULL)
   AND (d.namespace='' OR EXISTS(SELECT 1 FROM public.collection_product_tags t WHERE t.collection_id=c.id
    AND ((d.namespace='catalog' AND t.catalog_product_id=d.entity_id) OR (d.namespace='discovered' AND t.discovered_product_id=d.entity_id))))
 ), daily AS (
  SELECT day,metric,sum(value) AS value FROM scoped GROUP BY day,metric
 ), collections AS (
  SELECT d.collection_key AS id,sum(value) FILTER(WHERE metric='collection_opens') AS opens,
   sum(value) FILTER(WHERE metric='saves_added') AS saves,sum(value) FILTER(WHERE metric='merchant_requests') AS requests
  FROM scoped d WHERE d.day>=p_start AND d.collection_key<>'00000000-0000-0000-0000-000000000000'
  GROUP BY d.collection_key
  HAVING sum(value) FILTER(WHERE metric IN ('collection_opens','saves_added','merchant_requests'))>0
 ), top_collections AS (
  SELECT a.id,c.title,c.hero_thumbnail_url AS thumbnail_url,coalesce(a.opens,0) AS opens,
   coalesce(a.saves,0) AS saves,coalesce(a.requests,0) AS requests
  FROM collections a JOIN public.collections c ON c.id=a.id
  ORDER BY coalesce(a.opens,0) DESC,coalesce(a.requests,0) DESC,coalesce(a.saves,0) DESC,a.id LIMIT 5
 ), products AS (
  SELECT d.entity_id AS id,d.namespace,sum(value) FILTER(WHERE metric='product_impressions') AS impressions,
   sum(value) FILTER(WHERE metric='merchant_requests') AS requests
  FROM scoped d WHERE d.day>=p_start AND d.namespace IN ('catalog','discovered')
   AND metric IN ('product_impressions','merchant_requests') GROUP BY d.entity_id,d.namespace
 ), top_products AS (
  SELECT a.id,a.namespace,coalesce(cp.name,dp.name,'Product') AS title,
   coalesce(cp.image_url,dp.image_url) AS thumbnail_url,
   coalesce(a.impressions,0) AS impressions,coalesce(a.requests,0) AS requests
  FROM products a LEFT JOIN public.catalog_products cp ON a.namespace='catalog' AND cp.id=a.id AND cp.status<>'HIDDEN'
  LEFT JOIN public.discovered_products dp ON a.namespace='discovered' AND dp.id=a.id AND dp.internal_status='ACTIVE'
  WHERE cp.id IS NOT NULL OR dp.id IS NOT NULL
  ORDER BY coalesce(a.requests,0) DESC,coalesce(a.impressions,0) DESC,a.namespace,a.id LIMIT 5
 )
 SELECT jsonb_build_object('days',p_days,'end_day',p_end,'generated_at',now(),
  'refreshed_at',(SELECT last_scan FROM public.analytics_rollup_state WHERE singleton),
  'daily',coalesce((SELECT jsonb_agg(to_jsonb(daily) ORDER BY day,metric) FROM daily),'[]'),
  'coverage',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (
    SELECT (bucket AT TIME ZONE 'UTC')::date AS day,count(*) FILTER(WHERE enabled) AS windows
    FROM public.analytics_measurement_windows WHERE bucket>=(p_start-p_days)::timestamp AT TIME ZONE 'UTC'
     AND bucket<p_end::timestamp AT TIME ZONE 'UTC' GROUP BY 1) a),'[]'),
  'top_collections',coalesce((SELECT jsonb_agg(to_jsonb(top_collections)) FROM top_collections),'[]'),
  'top_products',coalesce((SELECT jsonb_agg(to_jsonb(top_products)) FROM top_products),'[]')) INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.analytics_creator_report_range(uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_creator_report_range(uuid,date,date) TO service_role;
