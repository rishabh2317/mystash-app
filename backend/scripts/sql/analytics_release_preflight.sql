BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
WITH facts AS (
 SELECT collection_id,count(*) FILTER(WHERE object_type='collection' AND interaction_type='view') views,
 count(*) FILTER(WHERE object_type='collection' AND interaction_type='share') shares,
 count(*) FILTER(WHERE interaction_type='merchant_click') clicks
 FROM public.engagement_interaction_facts WHERE collection_id IS NOT NULL GROUP BY collection_id
), saves AS (
 SELECT object_id,count(*) n FROM public.engagement_relationship_edges WHERE edge_type='SAVE' AND object_type='collection' AND state='ACTIVE' GROUP BY object_id
), followers AS (
 SELECT object_id,count(*) n FROM public.engagement_relationship_edges WHERE edge_type='FOLLOW' AND object_type='creator' AND state='ACTIVE' GROUP BY object_id
), following AS (
 SELECT user_id,count(*) n FROM public.engagement_relationship_edges WHERE edge_type='FOLLOW' AND state='ACTIVE' GROUP BY user_id
), inventory AS (
 SELECT 'collection'::text object_type,c.id::text object_id,v.counter_name,v.value,v.facts,v.cumulative
 FROM public.collections c LEFT JOIN facts f ON f.collection_id=c.id LEFT JOIN saves s ON s.object_id=c.id::text
 CROSS JOIN LATERAL (VALUES('views',c.views_count::bigint,coalesce(f.views,0),true),('shares',c.shares_count::bigint,coalesce(f.shares,0),true),('product_clicks',c.product_clicks_count::bigint,coalesce(f.clicks,0),true),('saves',c.saves_count::bigint,coalesce(s.n,0),false)) v(counter_name,value,facts,cumulative)
 UNION ALL
 SELECT v.object_type,u.id::text,v.counter_name,v.value,v.facts,false FROM public.users u LEFT JOIN followers f ON f.object_id=u.id::text LEFT JOIN following g ON g.user_id=u.id
 CROSS JOIN LATERAL (VALUES('creator','followers',u.followers_count::bigint,coalesce(f.n,0)),('user','following',u.following_count::bigint,coalesce(g.n,0))) v(object_type,counter_name,value,facts)
), checked AS (
 SELECT i.*,p.value projection FROM inventory i LEFT JOIN public.engagement_counter_projections p USING(object_type,object_id,counter_name)
)
SELECT jsonb_build_object(
 'mirror_counter_inventory',(SELECT jsonb_agg(x) FROM (SELECT object_type,counter_name,count(*) counters,sum(value) mirror_total,sum(facts) source_total,count(*) FILTER(WHERE projection IS NULL) missing_projections,count(*) FILTER(WHERE projection IS NOT NULL AND projection<>value) projection_drift,count(*) FILTER(WHERE NOT cumulative AND value<>facts) stock_drift,count(*) FILTER(WHERE cumulative AND value<facts) negative_legacy_offset,count(*) FILTER(WHERE value IS NULL OR value<0) invalid_mirrors FROM checked GROUP BY object_type,counter_name ORDER BY object_type,counter_name)x),
 'fact_counts',(SELECT jsonb_agg(x) FROM (SELECT object_type,interaction_type,count(*) n FROM public.engagement_interaction_facts GROUP BY object_type,interaction_type ORDER BY object_type,interaction_type)x),
 'unknown_projection_kinds',(SELECT count(*) FROM public.engagement_counter_projections WHERE NOT ((object_type='collection' AND counter_name IN ('views','saves','shares','product_clicks')) OR (object_type='creator' AND counter_name IN ('followers','shares')) OR (object_type='user' AND counter_name='following') OR (object_type='catalog_product' AND counter_name='merchant_clicks'))),
 'active_other_transactions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle' AND xact_start IS NOT NULL),
 'session_linked_facts',(SELECT count(*) FROM public.engagement_interaction_facts WHERE session_id IS NOT NULL)
) AS live_counter_preflight;
ROLLBACK;
