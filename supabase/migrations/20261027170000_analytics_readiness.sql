-- Scoped RPC deadlines. PostgREST v12+ must hoist statement_timeout before execution;
-- verify that behavior on the target API during rehearsal. Never change a shared role timeout.
ALTER FUNCTION public.analytics_rollup_creators(boolean) SET statement_timeout='20s';
ALTER FUNCTION public.analytics_rollup_creators(boolean) SET lock_timeout='2s';
ALTER FUNCTION public.analytics_rollup_admin(boolean) SET statement_timeout='20s';
ALTER FUNCTION public.analytics_rollup_admin(boolean) SET lock_timeout='2s';
ALTER FUNCTION public.analytics_interest_claim(integer) SET statement_timeout='20s';
ALTER FUNCTION public.analytics_interest_claim(integer) SET lock_timeout='2s';
ALTER FUNCTION public.analytics_interest_source(uuid) SET statement_timeout='20s';
ALTER FUNCTION public.analytics_interest_source(uuid) SET lock_timeout='2s';
ALTER FUNCTION public.analytics_interest_store(uuid,uuid,jsonb,boolean,timestamptz) SET statement_timeout='20s';
ALTER FUNCTION public.analytics_interest_store(uuid,uuid,jsonb,boolean,timestamptz) SET lock_timeout='2s';
ALTER FUNCTION public.analytics_maintenance() SET statement_timeout='20s';
ALTER FUNCTION public.analytics_maintenance() SET lock_timeout='2s';
ALTER FUNCTION public.engagement_check_and_record() SET statement_timeout='20s';
ALTER FUNCTION public.engagement_check_and_record() SET lock_timeout='2s';
ALTER FUNCTION public.analytics_set_preferences(uuid,boolean,boolean,uuid,boolean,boolean) SET statement_timeout='8s';
ALTER FUNCTION public.analytics_set_preferences(uuid,boolean,boolean,uuid,boolean,boolean) SET lock_timeout='2s';
NOTIFY pgrst,'reload schema';

-- Read-only cutover inventory. Historical cumulative totals can exceed surviving facts;
-- stocks must agree with authoritative relationship edges. No historical rows are changed.
CREATE VIEW public.engagement_counter_inventory AS
WITH facts AS (
 SELECT collection_id,count(*) FILTER(WHERE object_type='collection' AND interaction_type='view') views,
 count(*) FILTER(WHERE object_type='collection' AND interaction_type='share') shares,
 count(*) FILTER(WHERE interaction_type='merchant_click') clicks
 FROM public.engagement_interaction_facts WHERE collection_id IS NOT NULL GROUP BY collection_id
), saves AS (
 SELECT object_id,count(*) n FROM public.engagement_relationship_edges WHERE edge_type='SAVE' AND state='ACTIVE' AND object_type='collection' GROUP BY object_id
), followers AS (
 SELECT object_id,count(*) n FROM public.engagement_relationship_edges WHERE edge_type='FOLLOW' AND state='ACTIVE' AND object_type='creator' GROUP BY object_id
), following AS (
 SELECT user_id,count(*) n FROM public.engagement_relationship_edges WHERE edge_type='FOLLOW' AND state='ACTIVE' GROUP BY user_id
), nonmirror AS (
 SELECT 'creator'::text object_type,object_id,'shares'::text counter_name,count(*) n FROM public.engagement_interaction_facts WHERE object_type='creator' AND interaction_type='share' GROUP BY object_id
 UNION ALL
 SELECT 'catalog_product',object_id,'merchant_clicks',count(*) FROM public.engagement_interaction_facts WHERE object_type='catalog_product' AND interaction_type='merchant_click' GROUP BY object_id
), inventory AS (
 SELECT 'collection'::text object_type,c.id::text object_id,v.counter_name,v.value,v.facts,v.cumulative
 FROM public.collections c LEFT JOIN facts f ON f.collection_id=c.id LEFT JOIN saves s ON s.object_id=c.id::text
 CROSS JOIN LATERAL (VALUES ('views',c.views_count::bigint,coalesce(f.views,0),true),('shares',c.shares_count::bigint,coalesce(f.shares,0),true),
 ('product_clicks',c.product_clicks_count::bigint,coalesce(f.clicks,0),true),('saves',c.saves_count::bigint,coalesce(s.n,0),false)) v(counter_name,value,facts,cumulative)
 UNION ALL
 SELECT v.object_type,u.id::text,v.counter_name,v.value,v.facts,false FROM public.users u
 LEFT JOIN followers f ON f.object_id=u.id::text LEFT JOIN following g ON g.user_id=u.id
 CROSS JOIN LATERAL (VALUES ('creator', 'followers',u.followers_count::bigint,coalesce(f.n,0)),('user','following',u.following_count::bigint,coalesce(g.n,0))) v(object_type,counter_name,value,facts)
 UNION ALL
 SELECT coalesce(n.object_type,p.object_type),coalesce(n.object_id,p.object_id),coalesce(n.counter_name,p.counter_name),coalesce(p.value,n.n),coalesce(n.n,0),true
 FROM nonmirror n FULL JOIN public.engagement_counter_projections p ON p.object_type=n.object_type AND p.object_id=n.object_id AND p.counter_name=n.counter_name
 WHERE coalesce(n.object_type,p.object_type)='creator' AND coalesce(n.counter_name,p.counter_name)='shares'
 OR coalesce(n.object_type,p.object_type)='catalog_product' AND coalesce(n.counter_name,p.counter_name)='merchant_clicks'
)
SELECT i.*,p.value projection,b.value baseline FROM inventory i LEFT JOIN public.engagement_counter_projections p USING(object_type,object_id,counter_name)
 LEFT JOIN public.engagement_counter_baselines b USING(object_type,object_id,counter_name);
REVOKE ALL ON public.engagement_counter_inventory FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.engagement_counter_inventory TO service_role;
CREATE FUNCTION public.engagement_counter_preflight() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('counters',count(*),'missing_projections',count(*) FILTER(WHERE projection IS NULL),
 'missing_baselines',count(*) FILTER(WHERE cumulative AND baseline IS NULL),
 'blocking_drift',count(*) FILTER(WHERE value IS NULL OR value<0 OR (projection IS NOT NULL AND projection<>value)
 OR (NOT cumulative AND value<>facts) OR (cumulative AND value<facts) OR (baseline IS NOT NULL AND cumulative AND value<>facts+baseline)))
 FROM public.engagement_counter_inventory;
$$;
-- Explicit cutover preparation only, after all old/new writers have been drained.
-- Any ambiguous drift aborts the whole transaction; no mirrors, facts or edges are rewritten.
CREATE FUNCTION public.engagement_prepare_counter_baselines() RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 LOCK TABLE public.collections,public.users,public.engagement_interaction_facts,public.engagement_relationship_edges,
 public.engagement_counter_projections,public.engagement_counter_baselines IN SHARE ROW EXCLUSIVE MODE;
 IF (public.engagement_counter_preflight()->>'blocking_drift')::bigint<>0 THEN
  RAISE EXCEPTION 'Counter cutover blocked by drift; inspect inventory' USING ERRCODE='55000';
 END IF;
 INSERT INTO public.engagement_counter_baselines(object_type,object_id,counter_name,value)
 SELECT object_type,object_id,counter_name,value-facts FROM public.engagement_counter_inventory WHERE cumulative
 ON CONFLICT DO NOTHING;
 INSERT INTO public.engagement_counter_projections(object_type,object_id,counter_name,value)
 SELECT object_type,object_id,counter_name,value FROM public.engagement_counter_inventory ON CONFLICT DO NOTHING;
 RETURN public.engagement_counter_preflight();
END;
$$;
REVOKE ALL ON FUNCTION public.engagement_counter_preflight(),public.engagement_prepare_counter_baselines() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.engagement_counter_preflight(),public.engagement_prepare_counter_baselines() TO service_role;
ALTER FUNCTION public.engagement_prepare_counter_baselines() SET statement_timeout='20s';
ALTER FUNCTION public.engagement_prepare_counter_baselines() SET lock_timeout='2s';
